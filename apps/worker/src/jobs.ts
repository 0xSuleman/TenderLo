import { createHash } from "node:crypto";
import { basename } from "node:path";
import { createQaTask, createServiceClient, type DatabaseClient } from "@tenderlo/db";
import {
  buildCanonicalTenderId,
  calculateDuplicateConfidence,
  classifyTender,
  classifyTenderCategory,
  extractTenderFields,
  normalizeDepartment
} from "@tenderlo/intelligence";
import { sendNotification } from "@tenderlo/notifications";
import { mergeParsedPages, parseDocument } from "@tenderlo/parsing";
import { rebuildRecommendationRecords } from "@tenderlo/scoring";
import {
  logger,
  normalizeForSearch,
  normalizeWhitespace,
  pipelineRuntimeConfig,
  safeJson,
  sourceRuntimeConfig,
  PermanentSourceError,
  type ExtractedFieldResult,
  type Json,
  type RawTenderPayload
} from "@tenderlo/shared";
import { createSourceContext, fetchBinary, getSourceAdapter, isKnownSourceDomain, normalizeSourceHostname } from "@tenderlo/sources";

export async function ingestAllDueSources(): Promise<void> {
  const supabase = createServiceClient();
  const { data: sources, error } = await supabase
    .from("tender_sources")
    .select("*")
    .eq("status", "active")
    .order("last_run_at", { ascending: true, nullsFirst: true });
  if (error) throw error;

  const SOURCE_TIMEOUT_MS = 300_000; // 5 min — large sources (PPRA) have 200+ tenders with multiple DB writes each
  for (const source of (sources ?? []) as any[]) {
    const due = !source.last_run_at || Date.now() - new Date(source.last_run_at).getTime() >= source.scrape_frequency_minutes * 60_000;
    if (!due) continue;
    try {
      await Promise.race([
        ingestSource(source.id),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Source ingest timed out after ${SOURCE_TIMEOUT_MS / 1000}s`)), SOURCE_TIMEOUT_MS)
        )
      ]);
    } catch (error) {
      const msg = error instanceof Error ? error.message
        : (typeof error === "object" && error !== null && "message" in error) ? String((error as any).message)
        : typeof error === "string" ? error
        : JSON.stringify(error);
      logger.error("Tender source failed and was skipped for this batch.", {
        sourceId: source.id,
        sourceName: source.name,
        error: msg
      });
    }
  }
}

export async function ingestSource(sourceId: string): Promise<void> {
  const supabase = createServiceClient();
  const { data: source, error: sourceError } = await supabase.from("tender_sources").select("*").eq("id", sourceId).maybeSingle();
  if (sourceError) throw sourceError;
  if (!source) throw new Error(`Tender source ${sourceId} was not found.`);
  if (source.status === "disabled") return;

  const { data: run, error: runError } = await supabase
    .from("ingestion_runs")
    .insert({ source_id: source.id, status: "running" })
    .select("*")
    .single();
  if (runError) throw runError;

  let created = 0;
  let updated = 0;
  let duplicates = 0;

  try {
    await supabase.from("tender_sources").update({ last_run_at: new Date().toISOString() }).eq("id", source.id);
    const adapter = getSourceAdapter(source.adapter_key);
    const context = createSourceContext(source as any);
    context.parseDocument = parseDocument;
    const payloads = await adapter.fetchTenders(context);

    for (const payload of payloads) {
      await storeRawSnapshot(supabase, source as any, run as any, payload);
      const outcome = await upsertTenderFromPayload(supabase, source as any, payload);
      if (outcome.created) created += 1;
      else updated += 1;
      if (outcome.duplicatesFound) duplicates += outcome.duplicatesFound;
      await createSavedSearchNotificationsForTender(supabase, outcome.tenderId);
    }

    await supabase
      .from("ingestion_runs")
      .update({
        status: "succeeded",
        completed_at: new Date().toISOString(),
        tenders_seen: payloads.length,
        tenders_created: created,
        tenders_updated: updated,
        duplicates_found: duplicates
      })
      .eq("id", run.id);

    await supabase
      .from("tender_sources")
      .update({ status: "active", last_success_at: new Date().toISOString(), consecutive_failures: 0 })
      .eq("id", source.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ingestion error";
    const permanentFailure = error instanceof PermanentSourceError;
    const nextFailures = Number(source.consecutive_failures ?? 0) + 1;
    await supabase
      .from("ingestion_runs")
      .update({
        status: created || updated ? "partial" : "failed",
        completed_at: new Date().toISOString(),
        tenders_created: created,
        tenders_updated: updated,
        duplicates_found: duplicates,
        error_message: message
      })
      .eq("id", run.id);
    await supabase
      .from("tender_sources")
      .update({ status: permanentFailure || nextFailures >= 3 ? "failing" : "active", consecutive_failures: nextFailures })
      .eq("id", source.id);
    if (permanentFailure || nextFailures >= 3) {
      await createQaTask(supabase, {
        sourceId: source.id,
        taskType: "source_failure",
        priority: "high",
        title: permanentFailure ? `${source.name} is not publicly accessible` : `${source.name} failed ${nextFailures} consecutive ingestion runs`,
        details: safeJson({ error: message, source_id: source.id, permanent: permanentFailure })
      });
    }
    throw error;
  }
}

export async function closeExpiredTenders(): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("tenders")
    .update({ status: "closed" })
    .lt("closing_date", new Date().toISOString())
    .in("status", ["published", "corrigendum"]);
  if (error) throw error;
}

export async function rebuildRecommendations(organizationId?: string): Promise<void> {
  const supabase = createServiceClient();
  const records = await rebuildRecommendationRecords(organizationId, supabase);
  for (const record of records) {
    if (record.status !== "blocked" && record.score >= pipelineRuntimeConfig.highRecommendationAlertThreshold) {
      await createRecommendationNotifications(supabase, record.organizationId, record.tenderId, record.score, record.title);
    }
  }
}

export async function sendPendingAlerts(): Promise<void> {
  const supabase = createServiceClient();
  const { data: notifications, error } = await supabase
    .from("notifications")
    .select("*, organizations(primary_contact_email)")
    .eq("status", "pending")
    .lte("delivery_attempts", pipelineRuntimeConfig.maxNotificationDeliveryAttempts)
    .order("created_at", { ascending: true })
    .limit(pipelineRuntimeConfig.notificationBatchSize);
  if (error) throw error;

  for (const notification of (notifications ?? []) as any[]) {
    const to = notification.channel === "email" ? notification.organizations?.primary_contact_email : undefined;
    const result = await sendNotification({
      organizationId: notification.organization_id,
      userId: notification.user_id,
      channel: notification.channel,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      relatedTenderId: notification.related_tender_id,
      to
    });

    await supabase.from("notification_delivery_attempts").insert({
      notification_id: notification.id,
      channel: notification.channel,
      provider: notification.channel === "email" ? "smtp" : notification.channel === "whatsapp" ? "meta_whatsapp" : "in_app",
      provider_message_id: result.providerMessageId ?? null,
      status: result.status === "sent" ? "sent" : "failed",
      error_message: result.error ?? null,
      raw_response: safeJson(result)
    });

    await supabase
      .from("notifications")
      .update({
        status: result.status === "sent" ? "sent" : "failed",
        sent_at: result.status === "sent" ? new Date().toISOString() : null,
        last_error: result.error ?? null,
        delivery_attempts: Number(notification.delivery_attempts ?? 0) + 1
      })
      .eq("id", notification.id);
  }
}

async function upsertTenderFromPayload(
  supabase: DatabaseClient,
  source: { id: string; source_type: string; name: string; adapter_key?: string | null; metadata?: Json | null },
  payload: RawTenderPayload
): Promise<{ tenderId: string; created: boolean; duplicatesFound: number }> {
  const normalizedTitle = normalizeForSearch(payload.title);
  const canonicalTenderId = buildCanonicalTenderId({
    sourceId: source.id,
    sourceUrl: payload.sourceUrl,
    tenderNumber: payload.tenderNumber ?? null,
    title: payload.title,
    department: payload.department ?? null,
    closingDate: payload.closingDate ?? null
  });
  const classification = classifyTender({ title: payload.title, description: payload.description ?? null });
  const procurementCategory = payload.procurementCategory ?? classifyTenderCategory({ title: payload.title, description: payload.description ?? null });
  const primarySector = classification.find((match) => match.isPrimary)?.sector ?? "uncategorized";
  const extractionFields = [
    ...extractTenderFields(`${payload.title}\n${payload.description ?? ""}`),
    ...payloadMetadataFields(payload)
  ];
  const derived = deriveTenderValues(payload, extractionFields);
  const extractionConfidence = extractionFields.length
    ? extractionFields.reduce((sum, field) => sum + field.confidenceScore, 0) / extractionFields.length
    : pipelineRuntimeConfig.defaultExtractionConfidence;

  const { data: existing } = await supabase.from("tenders").select("*").eq("canonical_tender_id", canonicalTenderId).maybeSingle();
  let tender = existing;

  if (!existing?.is_human_verified) {
    const { data: upsertedTender, error } = await supabase
      .from("tenders")
      .upsert(
        {
          source_id: source.id,
          canonical_tender_id: canonicalTenderId,
          title: payload.title,
          normalized_title: normalizedTitle,
          source_url: payload.sourceUrl,
          tender_number: payload.tenderNumber ?? null,
          department: normalizeDepartment(payload.department) ?? payload.department ?? null,
          procurement_category: procurementCategory,
          sector: primarySector,
          province: payload.province ?? derived.province,
          city: payload.city ?? derived.city,
          description: payload.description ?? null,
          advertisement_date: payload.advertisementDate ?? null,
          closing_date: payload.closingDate ?? derived.closing_date,
          opening_date: payload.openingDate ?? derived.opening_date,
          bid_security_amount: payload.bidSecurityAmount ?? derived.bid_security_amount,
          estimated_value: payload.estimatedValue ?? derived.estimated_value,
          document_fee: payload.documentFee ?? derived.document_fee,
          status: extractionConfidence >= pipelineRuntimeConfig.publishConfidenceThreshold && primarySector !== "uncategorized" ? "published" : "under_review",
          extraction_confidence: extractionConfidence,
          is_human_verified: false
        },
        { onConflict: "canonical_tender_id" }
      )
      .select("*")
      .single();
    if (error) throw error;
    tender = upsertedTender;
  }

  if (!tender) throw new Error("Tender upsert did not return a record.");

  const sourceProvenance = buildSourceProvenance(source, payload);
  await supabase.from("tender_source_links").upsert(
    {
      tender_id: tender.id,
      source_id: source.id,
      source_url: payload.sourceUrl,
      provenance: safeJson({
        newspaperName: payload.newspaperName,
        publicationDate: payload.publicationDate,
        pageSection: payload.pageSection,
        sourceType: source.source_type,
        ...sourceProvenance
      })
    },
    { onConflict: "tender_id,source_url" }
  );
  if (sourceProvenance.originalSourceDomainKnown === false) {
    await createQaTask(supabase, {
      tenderId: tender.id,
      sourceId: source.id,
      taskType: "manual_verification",
      priority: "medium",
      title: `Unexpected source domain on ${source.name}`,
      details: safeJson(sourceProvenance)
    });
  }

  await persistSectorMatches(supabase, tender.id, classification);
  await persistExtractedFields(supabase, tender.id, null, extractionFields);
  await downloadAndParseDocuments(supabase, tender.id, payload, source);

  if (primarySector === "uncategorized") {
    await createQaTask(supabase, {
      tenderId: tender.id,
      sourceId: source.id,
      taskType: "manual_verification",
      priority: "medium",
      title: "Tender sector could not be classified",
      details: safeJson({ title: payload.title, sourceUrl: payload.sourceUrl })
    });
  }

  const duplicateCount = await detectAndMergeDuplicates(supabase, tender);
  return {
    tenderId: tender.id,
    created: !existing,
    duplicatesFound: duplicateCount
  };
}

async function downloadAndParseDocuments(
  supabase: DatabaseClient,
  tenderId: string,
  payload: RawTenderPayload,
  source: { adapter_key?: string | null; metadata?: Json | null }
): Promise<void> {
  const sourceGroup = metadataString(payload.sourceGroup) ?? metadataString(sourceMetadataValue(source.metadata, "sourceGroup"));
  const documentPrefix = metadataString(sourceMetadataValue(payload.sourceMetadata, "documentPrefix")) ?? metadataString(sourceMetadataValue(source.metadata, "documentPrefix")) ?? "tender_document";
  for (const document of payload.documents.slice(0, sourceRuntimeConfig.maxDocumentsPerTender)) {
    let fetched: Awaited<ReturnType<typeof fetchBinary>>;
    try {
      fetched = await fetchBinary(document.url);
    } catch (fetchErr) {
      await createQaTask(supabase, {
        tenderId,
        taskType: "parser_failure",
        priority: "medium",
        title: "Tender document fetch threw an exception",
        details: safeJson({ url: document.url, error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr) })
      });
      continue;
    }
    if (!fetched.ok) {
      await createQaTask(supabase, {
        tenderId,
        taskType: "parser_failure",
        priority: "medium",
        title: "Tender document could not be downloaded",
        details: safeJson({ url: document.url, status: fetched.status })
      });
      continue;
    }

    const hash = sha256(fetched.buffer);
    const filename = document.filename ?? (basename(new URL(document.url).pathname) || "tender-document");
    const storagePath = buildTenderDocumentStoragePath({
      adapterKey: source.adapter_key ?? "unknown-source",
      documentPrefix,
      tenderId,
      hash,
      filename
    });
    await supabase.storage.from("tender-documents").upload(storagePath, fetched.buffer, {
      contentType: fetched.contentType || document.mimeType || "application/octet-stream",
      upsert: true
    });

    const { data: tenderDocument, error } = await supabase
      .from("tender_documents")
      .upsert(
        {
          tender_id: tenderId,
          source_url: document.url,
          storage_path: storagePath,
          original_filename: filename,
          mime_type: fetched.contentType || document.mimeType || "application/octet-stream",
          content_hash: hash,
          parser_status: "pending",
          ocr_status: "not_needed"
        },
        { onConflict: "tender_id,content_hash" }
      )
      .select("*")
      .single();
    if (error) throw error;

    const parsed = await parseDocument({
      buffer: fetched.buffer,
      mimeType: fetched.contentType || document.mimeType || "application/octet-stream",
      filename,
      sourceUrl: document.url
    });

    await supabase
      .from("tender_documents")
      .update({
        page_count: parsed.pageCount,
        parser_status: parsed.parserStatus,
        ocr_status: parsed.ocrStatus
      })
      .eq("id", tenderDocument.id);

    if (parsed.parserStatus === "failed") {
      await createQaTask(supabase, {
        tenderId,
        taskType: "parser_failure",
        priority: "high",
        title: "Tender document parsing failed",
        details: safeJson({ document_id: tenderDocument.id, url: document.url, error: parsed.errorMessage })
      });
      continue;
    }

    for (const page of parsed.pages) {
      await supabase.from("parsed_document_text").upsert(
        {
          tender_document_id: tenderDocument.id,
          page_number: page.pageNumber,
          text: page.text,
          extraction_method: page.extractionMethod,
          confidence_score: page.confidenceScore
        },
        { onConflict: "tender_document_id,page_number,extraction_method" }
      );
    }

    const documentFields = extractTenderFields(mergeParsedPages(parsed.pages));
    await persistExtractedFields(supabase, tenderId, tenderDocument.id, documentFields);
    if (payload.newspaperName && parsed.ocrStatus === "completed") {
      await createQaTask(supabase, {
        tenderId,
        taskType: "manual_verification",
        priority: "medium",
        title: "OCR newspaper tender notice needs verification",
        details: safeJson({ document_id: tenderDocument.id, newspaper: payload.newspaperName, confidence: parsed.pages[0]?.confidenceScore ?? null })
      });
    }
  }
}

async function persistExtractedFields(
  supabase: DatabaseClient,
  tenderId: string,
  tenderDocumentId: string | null,
  fields: ExtractedFieldResult[]
): Promise<void> {
  for (const field of fields) {
    const { error } = await supabase.from("extracted_fields").insert({
      tender_id: tenderId,
      tender_document_id: tenderDocumentId,
      field_name: field.fieldName,
      field_value: field.fieldValue,
      source_method: field.sourceMethod,
      confidence_score: field.confidenceScore,
      evidence_text: field.evidenceText,
      verification_status: field.confidenceScore < pipelineRuntimeConfig.lowConfidenceFieldThreshold ? "needs_review" : field.verificationStatus
    });
    if (error && !String(error.message).includes("duplicate")) throw error;
    if (field.confidenceScore < pipelineRuntimeConfig.lowConfidenceFieldThreshold) {
      await createQaTask(supabase, {
        tenderId,
        taskType: "low_confidence_field",
        priority: "medium",
        title: `Low-confidence extraction for ${field.fieldName}`,
        details: safeJson(field)
      });
    }
  }
}

async function persistSectorMatches(supabase: DatabaseClient, tenderId: string, matches: Array<{ sector: string; score: number; matchedKeywords: string[]; isPrimary: boolean }>): Promise<void> {
  for (const match of matches) {
    await supabase.from("tender_sector_matches").upsert(
      {
        tender_id: tenderId,
        sector: match.sector,
        score: match.score,
        matched_keywords: match.matchedKeywords,
        is_primary: match.isPrimary
      },
      { onConflict: "tender_id,sector" }
    );
  }
}

async function detectAndMergeDuplicates(supabase: DatabaseClient, tender: any): Promise<number> {
  const { data: candidates } = await supabase
    .from("tenders")
    .select("id, source_url, tender_number, normalized_title, department, closing_date, bid_security_amount")
    .neq("id", tender.id)
    .or(`tender_number.eq.${tender.tender_number ?? "__none__"},normalized_title.eq.${tender.normalized_title}`)
    .limit(20);

  let duplicates = 0;
  for (const candidate of (candidates ?? []) as any[]) {
    const result = calculateDuplicateConfidence(
      {
        id: tender.id,
        source_url: tender.source_url,
        tender_number: tender.tender_number,
        normalized_title: tender.normalized_title,
        department: tender.department,
        closing_date: tender.closing_date,
        bid_security_amount: tender.bid_security_amount ? Number(tender.bid_security_amount) : null
      },
      {
        ...candidate,
        bid_security_amount: candidate.bid_security_amount ? Number(candidate.bid_security_amount) : null
      }
    );
    if (result.action === "keep") continue;
    duplicates += 1;
    await supabase.from("duplicate_candidates").upsert(
      {
        tender_id: tender.id,
        candidate_tender_id: candidate.id,
        confidence_score: result.confidenceScore,
        reasons: result.reasons,
        status: result.action === "merge" ? "merged" : "pending"
      },
      { onConflict: "tender_id,candidate_tender_id" }
    );
    if (result.action === "merge") {
      // tender.id is the freshly-ingested primary; candidate.id is the older duplicate to remove
      await mergeTenderRecords(supabase, tender.id, candidate.id);
    } else {
      await createQaTask(supabase, {
        tenderId: tender.id,
        taskType: "duplicate_review",
        priority: "medium",
        title: "Possible duplicate tender needs review",
        details: safeJson(result)
      });
    }
  }
  return duplicates;
}

async function mergeTenderRecords(supabase: DatabaseClient, primaryTenderId: string, duplicateTenderId: string): Promise<void> {
  await supabase.from("tender_documents").update({ tender_id: primaryTenderId }).eq("tender_id", duplicateTenderId);
  await supabase.from("extracted_fields").update({ tender_id: primaryTenderId }).eq("tender_id", duplicateTenderId);
  await supabase.from("tender_sector_matches").delete().eq("tender_id", duplicateTenderId);
  await supabase.from("tender_source_links").update({ tender_id: primaryTenderId }).eq("tender_id", duplicateTenderId);
  await supabase.from("tenders").delete().eq("id", duplicateTenderId);
}

async function storeRawSnapshot(
  supabase: DatabaseClient,
  source: { id: string },
  run: { id: string },
  payload: RawTenderPayload
): Promise<void> {
  const snapshot = payload.rawSnapshot;
  const body = Buffer.from(snapshot?.content ?? JSON.stringify(payload, null, 2));
  const hash = sha256(body);
  const contentType = snapshot?.contentType ?? "application/json";
  const extension = snapshot?.extension ?? extensionFromContentType(contentType);
  const storagePath = `${source.id}/${run.id}/${hash}.${extension}`;
  await supabase.storage.from("tender-source-snapshots").upload(storagePath, body, {
    contentType,
    upsert: true
  });
  await supabase.from("raw_source_snapshots").upsert(
    {
      source_id: source.id,
      ingestion_run_id: run.id,
      source_url: payload.sourceUrl,
      content_type: contentType,
      storage_path: storagePath,
      content_hash: hash
    },
    { onConflict: "source_id,content_hash" }
  );
}

function extensionFromContentType(contentType: string): string {
  if (contentType.includes("html")) return "html";
  if (contentType.includes("pdf")) return "pdf";
  if (contentType.includes("jpeg")) return "jpg";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("json")) return "json";
  return "bin";
}

async function createSavedSearchNotificationsForTender(supabase: DatabaseClient, tenderId: string): Promise<void> {
  const { data: tender } = await supabase.from("tenders").select("*").eq("id", tenderId).maybeSingle();
  if (!tender || tender.status !== "published") return;
  // Narrow the query so we never scan every saved search across all orgs (CRIT-04)
  let query = supabase.from("saved_searches").select("*, notification_rules(*)");
  if (tender.province) query = query.or(`filters->>province.is.null,filters->>province.eq.${tender.province}`);
  const { data: searches } = await query;
  for (const search of (searches ?? []) as any[]) {
    if (!matchesSavedSearch(tender, search)) continue;
    const rules = (search.notification_rules ?? []).filter((rule: any) => rule.enabled);
    for (const rule of rules) {
      const { data: existing } = await supabase
        .from("notifications")
        .select("id")
        .eq("organization_id", search.organization_id)
        .eq("user_id", search.user_id)
        .eq("related_tender_id", tender.id)
        .eq("type", "saved_search_match")
        .eq("channel", rule.channel)
        .limit(1);
      if (existing?.length) continue;

      await supabase.from("notifications").insert({
        organization_id: search.organization_id,
        user_id: search.user_id,
        type: "saved_search_match",
        title: `New tender match: ${tender.title}`,
        body: `${tender.department ?? "A source"} published a tender matching saved search "${search.name}". Closing date: ${tender.closing_date ?? "needs review"}.`,
        channel: rule.channel,
        status: rule.channel === "in_app" ? "sent" : "pending",
        related_tender_id: tender.id,
        sent_at: rule.channel === "in_app" ? new Date().toISOString() : null
      });
    }
  }
}

async function createRecommendationNotifications(
  supabase: DatabaseClient,
  organizationId: string,
  tenderId: string,
  score: number,
  title: string
): Promise<void> {
  const { data: existing } = await supabase
    .from("notifications")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("related_tender_id", tenderId)
    .eq("type", "recommendation")
    .limit(1);
  if (existing?.length) return;

  const { data: rules } = await supabase
    .from("notification_rules")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("enabled", true);
  const channels = new Set((rules ?? []).map((rule: any) => rule.channel));
  if (!channels.size) channels.add("in_app");
  for (const channel of channels) {
    await supabase.from("notifications").insert({
      organization_id: organizationId,
      type: "recommendation",
      title: `Recommended tender scored ${score}`,
      body: `${title} is a strong fit based on TenderLo's RECON scoring. Verify requirements before bidding.`,
      channel,
      status: channel === "in_app" ? "sent" : "pending",
      related_tender_id: tenderId,
      sent_at: channel === "in_app" ? new Date().toISOString() : null
    });
  }
}

function deriveTenderValues(payload: RawTenderPayload, fields: ExtractedFieldResult[]): Record<string, any> {
  const result: Record<string, any> = {};
  for (const field of fields) {
    if (result[field.fieldName] !== undefined) continue;
    if (["bid_security_amount", "estimated_value", "document_fee"].includes(field.fieldName)) {
      result[field.fieldName] = Number(field.fieldValue);
    } else {
      result[field.fieldName] = field.fieldValue;
    }
  }
  if (payload.publicationDate && !result.advertisement_date) result.advertisement_date = payload.publicationDate;
  return result;
}

function payloadMetadataFields(payload: RawTenderPayload): ExtractedFieldResult[] {
  const fields: ExtractedFieldResult[] = [];
  const evidence = normalizeWhitespace(`${payload.title}\n${payload.description ?? ""}`).slice(0, 500);
  for (const [fieldName, fieldValue] of [
    ["procurement_method", payload.procurementMethod],
    ["submission_method", payload.submissionMethod],
    ["contact_person", payload.contactPerson]
  ] as const) {
    if (!fieldValue) continue;
    fields.push({
      fieldName,
      fieldValue,
      sourceMethod: "html_selector",
      confidenceScore: 0.82,
      evidenceText: evidence || fieldValue,
      verificationStatus: "unverified"
    });
  }
  return fields;
}

export function buildSourceProvenance(
  source: { adapter_key?: string | null; metadata?: Json | null },
  payload: RawTenderPayload
): Record<string, unknown> {
  const knownSourceDomains = uniqueStrings([
    ...metadataStringArray(sourceMetadataValue(source.metadata, "knownSourceDomains")),
    ...metadataStringArray(sourceMetadataValue(payload.sourceMetadata, "knownSourceDomains"))
  ]);
  const originalSourceUrl = payload.originalSourceUrl ?? null;
  const websiteUrl = payload.websiteUrl ?? null;
  const originalSourceDomainKnown = originalSourceUrl ? isKnownSourceDomain(originalSourceUrl, knownSourceDomains) : null;
  const websiteDomainKnown = websiteUrl ? isKnownSourceDomain(websiteUrl, knownSourceDomains) : null;
  return {
    adapterKey: source.adapter_key ?? metadataString(sourceMetadataValue(payload.sourceMetadata, "adapterKey")) ?? null,
    sourceGroup: payload.sourceGroup ?? metadataString(sourceMetadataValue(source.metadata, "sourceGroup")) ?? null,
    sourceLabel: payload.sourceLabel ?? null,
    portalFamily: metadataString(sourceMetadataValue(payload.sourceMetadata, "portalFamily")) ?? metadataString(sourceMetadataValue(source.metadata, "portalFamily")) ?? null,
    documentPrefix: metadataString(sourceMetadataValue(payload.sourceMetadata, "documentPrefix")) ?? metadataString(sourceMetadataValue(source.metadata, "documentPrefix")) ?? null,
    sourceUrl: payload.sourceUrl,
    sourceHost: normalizeSourceHostname(payload.sourceUrl),
    originalSourceUrl,
    originalSourceHost: normalizeSourceHostname(originalSourceUrl),
    originalSourceDomainKnown,
    websiteUrl,
    websiteHost: normalizeSourceHostname(websiteUrl),
    websiteDomainKnown,
    knownSourceDomains,
    documentUrlCount: payload.documents.length
  };
}

export function buildTenderDocumentStoragePath(input: {
  adapterKey: string;
  documentPrefix: string;
  tenderId: string;
  hash: string;
  filename: string;
}): string {
  return [
    safePathSegment(input.adapterKey),
    safePathSegment(input.documentPrefix),
    input.tenderId,
    `${input.hash}-${safePathSegment(input.filename)}`
  ].join("/");
}

function sourceMetadataValue(metadata: Json | null | undefined, key: string): Json | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  return metadata[key];
}

function metadataString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function metadataStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())) : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

function safePathSegment(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180) || "file";
}

function matchesSavedSearch(tender: any, search: any): boolean {
  const query = normalizeForSearch(search.query ?? "");
  if (query) {
    // Use word-token intersection so "road" does not match "railroad" (HIGH-06)
    const queryTokens = new Set(query.split(/\s+/).filter(Boolean));
    const haystackText = normalizeForSearch(`${tender.title} ${tender.description ?? ""} ${tender.department ?? ""} ${tender.city ?? ""} ${tender.province ?? ""} ${tender.sector ?? ""}`);
    const haystackTokens = new Set(haystackText.split(/\s+/).filter(Boolean));
    for (const token of queryTokens) {
      if (!haystackTokens.has(token)) return false;
    }
  }
  const filters = search.filters ?? {};
  if (filters.province && tender.province !== filters.province) return false;
  if (filters.city && tender.city !== filters.city) return false;
  if (filters.sector && tender.sector !== filters.sector) return false;
  if (filters.status && tender.status !== filters.status) return false;
  return true;
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}
