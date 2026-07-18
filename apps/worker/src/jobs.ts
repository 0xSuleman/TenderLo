import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";
import { createQaTask, createServiceClient, type DatabaseClient } from "@tenderlo/db";
import {
  buildCanonicalTenderId,
  calculateDuplicateConfidence,
  classifyTender,
  classifyTenderCategory,
  extractFederalEpadsDocumentFields,
  extractKpPpraNoticeFields,
  extractPunjabPpraCorrectionFields,
  extractTenderFields,
  normalizeDepartment
} from "@tenderlo/intelligence";
import { sendNotification } from "@tenderlo/notifications";
import { mergeParsedPages, parseDocument } from "@tenderlo/parsing";
import { rebuildRecommendationRecords } from "@tenderlo/scoring";
import {
  logger,
  ingestionRuntimeConfig,
  normalizeForSearch,
  normalizeWhitespace,
  pipelineRuntimeConfig,
  safeJson,
  sourceRuntimeConfig,
  PermanentSourceError,
  rawTenderPayloadRuntimeSchema,
  type ExtractedFieldResult,
  type Json,
  type ParseDocumentResult,
  type RawTenderDocument,
  type RawTenderPayload
} from "@tenderlo/shared";
import { createSourceContext, fetchBinary, getSourceAdapter, isKnownSourceDomain, normalizeSourceHostname } from "@tenderlo/sources";

type ClaimedIngestionJob = {
  id: string;
  source_id: string;
  attempt_count: number;
  max_attempts: number;
  lease_token: string | null;
};

type IngestionMetrics = {
  rejected: number;
  documentsAdvertised: number;
  documentsDownloaded: number;
  documentsFailed: number;
  snapshotsStored: number;
};

export async function ingestAllDueSources(): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.rpc("enqueue_due_ingestion_jobs");
  if (error) {
    if (isMissingQueueSchemaError(error)) {
      logger.warn("Durable ingestion queue migration has not been applied; using the direct scheduler temporarily.");
      await ingestAllDueSourcesLegacy();
      return;
    }
    throw error;
  }
  await processQueuedIngestionJobs(supabase);
}

/** Processes durable jobs. Safe for concurrent worker instances because claim_ingestion_jobs uses SKIP LOCKED. */
export async function processQueuedIngestionJobs(supabase = createServiceClient()): Promise<number> {
  const workerToken = randomUUID();
  const { data, error } = await supabase.rpc("claim_ingestion_jobs", {
    p_worker_token: workerToken,
    p_limit: ingestionRuntimeConfig.queueBatchSize,
    p_lease_seconds: ingestionRuntimeConfig.leaseSeconds
  });
  if (error) throw error;

  let processed = 0;
  for (const job of (data ?? []) as ClaimedIngestionJob[]) {
    try {
      await ingestSource(job.source_id, job);
    } catch (error) {
      logger.error("Ingestion job failed; its retry or dead-letter state was persisted.", {
        jobId: job.id,
        sourceId: job.source_id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    processed += 1;
  }
  await enforceMachineQualityGate(supabase);
  return processed;
}

async function ingestAllDueSourcesLegacy(): Promise<void> {
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
    const sourceTimeoutMs = [
      "federal-epads",
      "federal-ppra-active",
      "punjab-ppra",
      "sindh-sppra",
      "kp-ppra-active",
      "balochistan-bppra"
    ].includes(source.adapter_key)
      ? 60 * 60_000 // Large EPMS portals require polite API/detail/document crawls plus many idempotent DB writes.
      : SOURCE_TIMEOUT_MS;
    try {
      await Promise.race([
        ingestSource(source.id),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Source ingest timed out after ${sourceTimeoutMs / 1000}s`)), sourceTimeoutMs)
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
  await enforceMachineQualityGate(supabase);
}

export async function ingestSource(sourceId: string, job?: ClaimedIngestionJob): Promise<void> {
  const supabase = createServiceClient();
  const { data: source, error: sourceError } = await supabase.from("tender_sources").select("*").eq("id", sourceId).maybeSingle();
  if (sourceError) throw sourceError;
  if (!source) throw new Error(`Tender source ${sourceId} was not found.`);
  if (source.status === "disabled") {
    if (job) await completeIngestionJob(supabase, job, "cancelled");
    return;
  }

  const { data: run, error: runError } = await supabase
    .from("ingestion_runs")
    .insert({ source_id: source.id, status: "running", ...(job ? { job_id: job.id } : {}) })
    .select("*")
    .single();
  if (runError) throw runError;

  let created = 0;
  let updated = 0;
  let duplicates = 0;
  const metrics: IngestionMetrics = {
    rejected: 0,
    documentsAdvertised: 0,
    documentsDownloaded: 0,
    documentsFailed: 0,
    snapshotsStored: 0
  };

  try {
    await supabase.from("tender_sources").update({ last_run_at: new Date().toISOString() }).eq("id", source.id);
    const adapter = getSourceAdapter(source.adapter_key);
    const context = createSourceContext(source as any);
    context.parseDocument = parseDocument;
    const payloads = await adapter.fetchTenders(context);
    const documentBudget = { remaining: sourceRuntimeConfig.maxDocumentDownloadsPerSourceRun };

    for (const payload of payloads) {
      const payloadErrors = validateSourcePayload(payload);
      if (payloadErrors.length) {
        metrics.rejected += 1;
        await createMalformedPayloadQaTask(supabase, source as any, payload, payloadErrors);
        continue;
      }
      metrics.documentsAdvertised += payload.documents.length;
      await storeRawSnapshot(supabase, source as any, run as any, payload);
      metrics.snapshotsStored += 1;
      const outcome = await upsertTenderFromPayload(supabase, source as any, payload, documentBudget);
      if (!outcome.admitted) {
        metrics.rejected += 1;
        continue;
      }
      if (outcome.created) created += 1;
      else updated += 1;
      if (outcome.duplicatesFound) duplicates += outcome.duplicatesFound;
      metrics.documentsDownloaded += outcome.documentsDownloaded;
      metrics.documentsFailed += outcome.documentsFailed;
      await createSavedSearchNotificationsForTender(supabase, outcome.tenderId);
    }

    await supabase
      .from("ingestion_runs")
      .update({
        status: metrics.rejected ? "partial" : "succeeded",
        completed_at: new Date().toISOString(),
        tenders_seen: payloads.length,
        tenders_created: created,
        tenders_updated: updated,
        duplicates_found: duplicates,
        tenders_rejected: metrics.rejected,
        documents_advertised: metrics.documentsAdvertised,
        documents_downloaded: metrics.documentsDownloaded,
        documents_failed: metrics.documentsFailed,
        snapshots_stored: metrics.snapshotsStored,
        error_message: metrics.rejected ? `${metrics.rejected} payload(s) rejected by validation or admission rules.` : null
      })
      .eq("id", run.id);

    await supabase
      .from("tender_sources")
      .update({
        status: "active",
        last_success_at: new Date().toISOString(),
        consecutive_failures: 0,
        circuit_open_until: null,
        last_error: null
      })
      .eq("id", source.id);
    if (job) await completeIngestionJob(supabase, job, "succeeded", run.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ingestion error";
    const permanentFailure = error instanceof PermanentSourceError;
    const nextFailures = Number(source.consecutive_failures ?? 0) + 1;
    const circuitOpenUntil = permanentFailure || nextFailures < ingestionRuntimeConfig.circuitFailureThreshold
      ? null
      : circuitOpenUntilFor(nextFailures);
    await supabase
      .from("ingestion_runs")
      .update({
        status: created || updated ? "partial" : "failed",
        completed_at: new Date().toISOString(),
        tenders_created: created,
        tenders_updated: updated,
        duplicates_found: duplicates,
        tenders_rejected: metrics.rejected,
        documents_advertised: metrics.documentsAdvertised,
        documents_downloaded: metrics.documentsDownloaded,
        documents_failed: metrics.documentsFailed,
        snapshots_stored: metrics.snapshotsStored,
        error_message: message
      })
      .eq("id", run.id);
    await supabase
      .from("tender_sources")
      .update({
        status: permanentFailure ? "failing" : "active",
        consecutive_failures: nextFailures,
        circuit_open_until: circuitOpenUntil,
        last_failure_at: new Date().toISOString(),
        last_error: message
      })
      .eq("id", source.id);
    if (permanentFailure || nextFailures >= ingestionRuntimeConfig.circuitFailureThreshold) {
      await createQaTask(supabase, {
        sourceId: source.id,
        taskType: "source_failure",
        priority: "high",
        title: permanentFailure ? `${source.name} is not publicly accessible` : `${source.name} failed ${nextFailures} consecutive ingestion runs`,
        details: safeJson({ error: message, source_id: source.id, permanent: permanentFailure })
      });
    }
    if (job) await retryOrDeadLetterIngestionJob(supabase, job, message, permanentFailure, run.id);
    throw error;
  }
}

export function validateSourcePayload(payload: unknown): string[] {
  const result = rawTenderPayloadRuntimeSchema.safeParse(payload);
  if (result.success) return [];
  return result.error.issues.map((issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`);
}

export function retryDelaySeconds(attemptCount: number): number {
  const exponent = Math.max(0, attemptCount - 1);
  return Math.min(
    ingestionRuntimeConfig.retryBaseDelaySeconds * (2 ** exponent),
    ingestionRuntimeConfig.retryMaxDelaySeconds
  );
}

export function circuitOpenUntilFor(consecutiveFailures: number, now = new Date()): string {
  const exponent = Math.max(0, consecutiveFailures - ingestionRuntimeConfig.circuitFailureThreshold);
  const delayMinutes = Math.min(
    ingestionRuntimeConfig.circuitBaseDelayMinutes * (2 ** exponent),
    ingestionRuntimeConfig.circuitMaxDelayMinutes
  );
  return new Date(now.getTime() + delayMinutes * 60_000).toISOString();
}

async function completeIngestionJob(
  supabase: DatabaseClient,
  job: ClaimedIngestionJob,
  status: "succeeded" | "cancelled",
  ingestionRunId?: string
): Promise<void> {
  const { error } = await supabase
    .from("ingestion_jobs")
    .update({
      status,
      ingestion_run_id: ingestionRunId ?? null,
      completed_at: new Date().toISOString(),
      lease_token: null,
      lease_expires_at: null,
      last_error: null
    })
    .eq("id", job.id)
    .eq("lease_token", job.lease_token);
  if (error) throw error;
}

async function retryOrDeadLetterIngestionJob(
  supabase: DatabaseClient,
  job: ClaimedIngestionJob,
  message: string,
  permanentFailure: boolean,
  ingestionRunId: string
): Promise<void> {
  const exhausted = permanentFailure || job.attempt_count >= job.max_attempts;
  const status = exhausted ? "dead_letter" : "queued";
  const scheduledFor = exhausted
    ? new Date().toISOString()
    : new Date(Date.now() + retryDelaySeconds(job.attempt_count) * 1_000).toISOString();
  const { error } = await supabase
    .from("ingestion_jobs")
    .update({
      status,
      scheduled_for: scheduledFor,
      ingestion_run_id: ingestionRunId,
      completed_at: exhausted ? new Date().toISOString() : null,
      lease_token: null,
      lease_expires_at: null,
      last_error: message
    })
    .eq("id", job.id)
    .eq("lease_token", job.lease_token);
  if (error) throw error;

  if (exhausted) {
    await createQaTask(supabase, {
      sourceId: job.source_id,
      taskType: "source_failure",
      priority: "urgent",
      title: `Ingestion job moved to dead letter after ${job.attempt_count} attempt(s)`,
      details: safeJson({ jobId: job.id, sourceId: job.source_id, error: message, permanent: permanentFailure })
    });
  }
}

function isMissingQueueSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String((error as { message?: unknown } | null)?.message ?? error);
  return /enqueue_due_ingestion_jobs|ingestion_jobs|could not find.*function|does not exist/i.test(message);
}

async function createMalformedPayloadQaTask(
  supabase: DatabaseClient,
  source: { id: string; name: string },
  payload: unknown,
  reasons: string[]
): Promise<void> {
  const candidate = typeof payload === "object" && payload !== null ? payload as Partial<RawTenderPayload> : {};
  const tenderNumber = typeof candidate.tenderNumber === "string" ? candidate.tenderNumber.trim() : "";
  await createQaTask(supabase, {
    sourceId: source.id,
    taskType: "parser_failure",
    priority: "high",
    title: `Source payload rejected before persistence: ${tenderNumber || source.name}`,
    details: safeJson({ source: source.name, sourceUrl: candidate.sourceUrl ?? null, title: candidate.title ?? null, reasons })
  });
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

/**
 * Enforces the machine-owned publication boundary. Tenders that never passed
 * document parsing or deterministic classification are removed; stale QA
 * incidents are dismissed after the machine has made that disposition.
 */
export async function enforceMachineQualityGate(supabase = createServiceClient()): Promise<{
  discardedTenders: number;
  dismissedTasks: number;
  rejectedDuplicateCandidates: number;
}> {
  const candidates: any[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase
      .from("tenders")
      .select("id,status,title,tender_number,department,source_url,advertisement_date,closing_date,sector")
      .in("status", ["published", "corrigendum", "under_review"])
      .order("created_at", { ascending: true })
      .range(offset, offset + 499);
    if (error) throw error;
    candidates.push(...(data ?? []));
    if ((data?.length ?? 0) < 500) break;
  }

  const parsedTenderIds = new Set<string>();
  const storagePathsByTenderId = new Map<string, string[]>();
  for (let offset = 0; offset < candidates.length; offset += 100) {
    const tenderIds = candidates.slice(offset, offset + 100).map((tender) => tender.id);
    const { data: documents, error } = await supabase
      .from("tender_documents")
      .select("tender_id,parser_status,storage_path")
      .in("tender_id", tenderIds);
    if (error) throw error;
    for (const document of documents ?? []) {
      if (document.parser_status === "parsed") parsedTenderIds.add(document.tender_id);
      const paths = storagePathsByTenderId.get(document.tender_id) ?? [];
      if (document.storage_path) paths.push(document.storage_path);
      storagePathsByTenderId.set(document.tender_id, paths);
    }
  }

  const discardIds = candidates
    .filter((tender) => tender.status === "under_review"
      || !parsedTenderIds.has(tender.id)
      || !tender.title
      || !tender.tender_number
      || !tender.department
      || !tender.source_url
      || !tender.closing_date
      || !tender.sector
      || tender.sector === "uncategorized")
    .map((tender) => tender.id);

  const storagePaths = discardIds.flatMap((id) => storagePathsByTenderId.get(id) ?? []);
  for (let offset = 0; offset < storagePaths.length; offset += 100) {
    const { error } = await supabase.storage.from("tender-documents").remove(storagePaths.slice(offset, offset + 100));
    if (error) throw error;
  }
  for (let offset = 0; offset < discardIds.length; offset += 100) {
    const { error } = await supabase.from("tenders").delete().in("id", discardIds.slice(offset, offset + 100));
    if (error) throw error;
  }

  const { data: dismissedTasks, error: taskError } = await supabase
    .from("qa_tasks")
    .update({ status: "dismissed", resolved_at: new Date().toISOString() })
    .in("status", ["open", "in_progress"])
    .select("id");
  if (taskError) throw taskError;

  const { data: rejectedDuplicates, error: duplicateError } = await supabase
    .from("duplicate_candidates")
    .update({ status: "rejected" })
    .eq("status", "pending")
    .select("id");
  if (duplicateError) throw duplicateError;

  const result = {
    discardedTenders: discardIds.length,
    dismissedTasks: dismissedTasks?.length ?? 0,
    rejectedDuplicateCandidates: rejectedDuplicates?.length ?? 0
  };
  logger.info("Machine quality gate completed.", result);
  return result;
}

export async function backfillStoredTenderFields(sourceId?: string, tenderId?: string, startOffset = 0): Promise<void> {
  const supabase = createServiceClient();
  const { data: sources, error: sourceError } = await supabase.from("tender_sources").select("id,adapter_key");
  if (sourceError) throw sourceError;
  const adapterBySourceId = new Map<string, string | null>((sources ?? []).map((source: any) => [source.id, source.adapter_key as string | null]));
  let documentOffset = startOffset;
  let processedDocuments = 0;
  let refreshedFields = 0;
  const batchSize = 10;

  while (true) {
    let documentQuery = supabase
      .from("tender_documents")
      .select("id,tender_id,tenders!inner(source_id,is_human_verified,closing_date,opening_date,bid_security_amount,estimated_value,document_fee,province,city)")
      .eq("parser_status", "parsed")
      .order("created_at", { ascending: true })
      .range(documentOffset, documentOffset + batchSize - 1);
    if (sourceId) documentQuery = documentQuery.eq("tenders.source_id", sourceId);
    if (tenderId && tenderId !== "all") documentQuery = documentQuery.eq("tender_id", tenderId);
    const { data: documents, error: documentError } = await documentQuery;
    if (documentError) throw documentError;
    if (!documents?.length) break;

    const documentIds = documents.map((document: any) => document.id);
    const { data: pages, error: pageError } = await supabase
      .from("parsed_document_text")
      .select("tender_document_id,page_number,text")
      .in("tender_document_id", documentIds)
      .order("page_number", { ascending: true });
    if (pageError) throw pageError;
    const textByDocumentId = new Map<string, string[]>();
    for (const page of pages ?? []) {
      const values = textByDocumentId.get(page.tender_document_id) ?? [];
      values.push(page.text);
      textByDocumentId.set(page.tender_document_id, values);
    }

    const fieldsByDocumentId = new Map<string, ExtractedFieldResult[]>();
    for (const document of documents as any[]) {
      const tenderRelation = Array.isArray(document.tenders) ? document.tenders[0] : document.tenders;
      if (!tenderRelation || tenderRelation.is_human_verified) continue;
      const documentText = (textByDocumentId.get(document.id) ?? []).join("\n");
      if (!documentText.trim()) continue;
      const fields = normalizeDocumentFieldsForSource(
        extractTenderFields(documentText),
        adapterBySourceId.get(tenderRelation.source_id),
        documentText
      ).filter((field) => field.confidenceScore >= pipelineRuntimeConfig.lowConfidenceFieldThreshold && field.verificationStatus !== "needs_review");
      fieldsByDocumentId.set(document.id, fields);
    }

    const { error: deleteError } = await supabase
      .from("extracted_fields")
      .delete()
      .in("tender_id", [...new Set((documents as any[]).map((document) => document.tender_id))])
      .in("tender_document_id", documentIds)
      .neq("verification_status", "verified");
    if (deleteError) throw deleteError;

    const fieldRows = (documents as any[]).flatMap((document) => (fieldsByDocumentId.get(document.id) ?? []).map((field) => ({
      tender_id: document.tender_id,
      tender_document_id: document.id,
      field_name: field.fieldName,
      field_value: field.fieldValue,
      source_method: field.sourceMethod,
      confidence_score: field.confidenceScore,
      evidence_text: field.evidenceText,
      verification_status: field.verificationStatus
    })));
    for (let fieldOffset = 0; fieldOffset < fieldRows.length; fieldOffset += 500) {
      const { error: insertError } = await supabase.from("extracted_fields").insert(fieldRows.slice(fieldOffset, fieldOffset + 500));
      if (insertError) throw insertError;
    }

    for (const document of documents as any[]) {
      const tenderRelation = Array.isArray(document.tenders) ? document.tenders[0] : document.tenders;
      const fields = fieldsByDocumentId.get(document.id) ?? [];
      if (!tenderRelation || !fields.length) continue;
      const updates = buildTenderFieldPromotion(tenderRelation, fields);
      if (Object.keys(updates).length) {
        const { error: updateError } = await supabase.from("tenders").update(updates).eq("id", document.tender_id);
        if (updateError) throw updateError;
      }
      processedDocuments += 1;
      refreshedFields += fields.length;
    }

    documentOffset += documents.length;
    logger.info("Stored tender field backfill batch completed.", { processedDocuments, refreshedFields, sourceId: sourceId ?? "all", tenderId: tenderId ?? "all" });
    if (documents.length < batchSize) break;
  }

  logger.info("Stored tender field backfill completed.", { processedDocuments, refreshedFields, sourceId: sourceId ?? "all", tenderId: tenderId ?? "all" });
}

async function upsertTenderFromPayload(
  supabase: DatabaseClient,
  source: { id: string; source_type: string; name: string; adapter_key?: string | null; metadata?: Json | null },
  payload: RawTenderPayload,
  documentBudget: { remaining: number }
): Promise<
  | { admitted: true; tenderId: string; created: boolean; duplicatesFound: number; documentsDownloaded: number; documentsFailed: number }
  | { admitted: false; documentsDownloaded: number; documentsFailed: number }
> {
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
  let extractionFields = [
    ...extractTenderFields(`${payload.title}\n${payload.description ?? ""}`),
    ...payloadMetadataFields(payload)
  ];
  if (source.adapter_key === "federal-epads" || source.adapter_key === "federal-ppra-active") {
    extractionFields = appendFederalEstimatedValueLowerBound(extractionFields);
  }
  const derived = deriveTenderValues(payload, extractionFields);
  const extractionConfidence = extractionFields.length
    ? extractionFields.reduce((sum, field) => sum + field.confidenceScore, 0) / extractionFields.length
    : pipelineRuntimeConfig.defaultExtractionConfidence;
  const sourceRequiresReview = /violated|cancel(?:led|ed)?|withdrawn|rejected/i.test(payload.sourceStatus ?? "");

  const { data: canonicalExisting } = await supabase.from("tenders").select("*").eq("canonical_tender_id", canonicalTenderId).maybeSingle();
  let existing = canonicalExisting;
  if (!existing && payload.sourceUrl) {
    const { data: sourceUrlExisting } = await supabase
      .from("tenders")
      .select("*")
      .eq("source_id", source.id)
      .eq("source_url", payload.sourceUrl)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    existing = sourceUrlExisting;
  }
  let tender = existing;
  let preparedAdmissionDocument: PreparedTenderDocument | undefined;

  if (!existing) {
    const admissionErrors = [
      ...validateNewTenderAdmission(payload),
      ...(primarySector === "uncategorized" ? ["Tender sector could not be classified deterministically."] : []),
      ...(sourceRequiresReview ? [`Source status is not publishable: ${payload.sourceStatus}.`] : [])
    ];
    if (admissionErrors.length) {
      await createRejectedTenderQaTask(supabase, source, payload, admissionErrors);
      return { admitted: false, documentsDownloaded: 0, documentsFailed: 0 };
    }

    try {
      preparedAdmissionDocument = await prepareFirstAvailableTenderDocument(
        payload.documents.slice(0, sourceRuntimeConfig.maxDocumentsPerTender)
      );
    } catch (error) {
      await createRejectedTenderQaTask(supabase, source, payload, [
        error instanceof Error ? error.message : String(error)
      ]);
      return { admitted: false, documentsDownloaded: 0, documentsFailed: 0 };
    }
  }

  if (!existing?.is_human_verified) {
    const values = {
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
      status: primarySector !== "uncategorized" && !sourceRequiresReview ? "published" : "cancelled",
      extraction_confidence: extractionConfidence,
      is_human_verified: false
    };
    const persistence = existing
      ? supabase.from("tenders").update(values).eq("id", existing.id)
      : supabase.from("tenders").upsert(values, { onConflict: "canonical_tender_id" });
    const { data: upsertedTender, error } = await persistence.select("*").single();
    if (error) throw error;
    tender = upsertedTender;
  }

  if (!tender) throw new Error("Tender upsert did not return a record.");

  if (!existing && preparedAdmissionDocument) {
    const documentPrefix = metadataString(sourceMetadataValue(payload.sourceMetadata, "documentPrefix"))
      ?? metadataString(sourceMetadataValue(source.metadata, "documentPrefix"))
      ?? "tender_document";
    try {
      await persistPreparedTenderDocument(
        supabase,
        tender.id,
        payload,
        source,
        documentPrefix,
        preparedAdmissionDocument
      );
    } catch (error) {
      const storagePath = buildTenderDocumentStoragePath({
        adapterKey: source.adapter_key ?? "unknown-source",
        documentPrefix,
        tenderId: tender.id,
        hash: preparedAdmissionDocument.hash,
        filename: preparedAdmissionDocument.filename
      });
      await supabase.storage.from("tender-documents").remove([storagePath]);
      await supabase.from("tenders").delete().eq("id", tender.id);
      await createRejectedTenderQaTask(supabase, source, payload, [
        `Validated document could not be persisted: ${error instanceof Error ? error.message : String(error)}`
      ]);
      return { admitted: false, documentsDownloaded: 0, documentsFailed: 0 };
    }
  }

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
  const sourceDocumentErrors = metadataStringArray(sourceMetadataValue(payload.sourceMetadata, "documentLookupErrors"));
  if (sourceDocumentErrors.length) {
    await createQaTask(supabase, {
      tenderId: tender.id,
      sourceId: source.id,
      taskType: "parser_failure",
      priority: "medium",
      title: `Source document inventory is incomplete on ${source.name}`,
      details: safeJson({ sourceUrl: payload.sourceUrl, errors: sourceDocumentErrors })
    });
  }

  await persistSectorMatches(supabase, tender.id, classification);
  await persistExtractedFields(supabase, tender.id, null, extractionFields);
  const documentOutcome = await downloadAndParseDocuments(
    supabase,
    tender.id,
    payload,
    source,
    documentBudget,
    preparedAdmissionDocument?.document.url
  );

  if (primarySector === "uncategorized" && procurementCategory.trim().toLowerCase() === "works") {
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
    admitted: true,
    tenderId: tender.id,
    created: !existing,
    duplicatesFound: duplicateCount,
    documentsDownloaded: (preparedAdmissionDocument ? 1 : 0) + documentOutcome.downloaded,
    documentsFailed: documentOutcome.failed
  };
}

export function validateNewTenderAdmission(payload: RawTenderPayload, now = new Date()): string[] {
  const errors: string[] = [];
  if (!payload.title.trim()) errors.push("Tender title is missing.");
  if (!payload.tenderNumber?.trim()) errors.push("Tender number is missing.");
  if (!payload.department?.trim()) errors.push("Procuring department is missing.");
  if (!payload.sourceUrl.trim()) errors.push("Source URL is missing.");
  const sourceMetadata = payload.sourceMetadata as Record<string, Json> | undefined;
  const isSsgcPublicListing = sourceMetadata?.adapterKey === "ssgc-active-tenders";
  if ((!payload.advertisementDate || Number.isNaN(Date.parse(payload.advertisementDate))) && !isSsgcPublicListing) {
    errors.push("Advertisement date is missing or invalid.");
  }
  if (!payload.closingDate || Number.isNaN(Date.parse(payload.closingDate))) {
    errors.push("Closing date is missing or invalid.");
  } else if (Date.parse(payload.closingDate) <= now.getTime()) {
    errors.push("Tender closing date has already passed.");
  }
  if (!payload.documents.length) errors.push("No primary tender document was advertised by the source.");
  else if (!payload.documents.some(isBinaryTenderDocumentReference)) {
    errors.push("No downloadable PDF, DOCX, or image tender document was advertised by the source.");
  }
  return errors;
}

type PreparedTenderDocument = {
  document: RawTenderDocument;
  buffer: Buffer;
  contentType: string;
  filename: string;
  hash: string;
  parsed: ParseDocumentResult;
};

async function createRejectedTenderQaTask(
  supabase: DatabaseClient,
  source: { id: string; name: string },
  payload: RawTenderPayload,
  reasons: string[]
): Promise<void> {
  await createQaTask(supabase, {
    sourceId: source.id,
    taskType: "parser_failure",
    priority: "high",
    title: `Tender rejected before persistence: ${payload.tenderNumber?.trim() || sha256(Buffer.from(payload.sourceUrl)).slice(0, 12)}`,
    details: safeJson({
      source: source.name,
      sourceUrl: payload.sourceUrl,
      tenderNumber: payload.tenderNumber ?? null,
      title: payload.title,
      reasons
    })
  });
}

async function prepareFirstAvailableTenderDocument(documents: RawTenderDocument[]): Promise<PreparedTenderDocument> {
  const failures: string[] = [];
  for (const document of documents) {
    try {
      return await prepareTenderDocument(document);
    } catch (error) {
      failures.push(`${document.url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`No advertised tender document could be fetched and validated. ${failures.join(" | ")}`);
}

async function prepareTenderDocument(document: RawTenderDocument): Promise<PreparedTenderDocument> {
  let fetched: Awaited<ReturnType<typeof fetchBinary>>;
  try {
    fetched = await fetchBinary(document.url, undefined, document.downloadRequest);
  } catch (error) {
    throw new Error(`Document fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!fetched.ok) throw new Error(`Document download returned HTTP ${fetched.status}.`);

  const filename = fetched.filename ?? document.filename ?? (basename(new URL(document.url).pathname) || "tender-document");
  const validationError = validateDownloadedDocument({
    buffer: fetched.buffer,
    contentType: fetched.contentType,
    filename
  });
  if (validationError) throw new Error(validationError);

  const contentType = fetched.contentType || document.mimeType || "application/octet-stream";
  const parsed = await parseDocument({
    buffer: fetched.buffer,
    mimeType: contentType,
    filename,
    sourceUrl: document.url
  });
  if (parsed.parserStatus !== "parsed" || parsed.pages.length === 0) {
    throw new Error(parsed.errorMessage || "Tender document could not be parsed into evidence text.");
  }
  return {
    document,
    buffer: fetched.buffer,
    contentType,
    filename,
    hash: sha256(fetched.buffer),
    parsed
  };
}

async function downloadAndParseDocuments(
  supabase: DatabaseClient,
  tenderId: string,
  payload: RawTenderPayload,
  source: { id: string; adapter_key?: string | null; metadata?: Json | null },
  documentBudget: { remaining: number },
  persistedAdmissionDocumentUrl?: string
): Promise<{ downloaded: number; failed: number }> {
  const documentPrefix = metadataString(sourceMetadataValue(payload.sourceMetadata, "documentPrefix")) ?? metadataString(sourceMetadataValue(source.metadata, "documentPrefix")) ?? "tender_document";
  let downloaded = 0;
  let failed = 0;
  for (const document of payload.documents.slice(0, sourceRuntimeConfig.maxDocumentsPerTender)) {
    if (persistedAdmissionDocumentUrl === document.url) continue;
    const { data: recentDocument, error: recentDocumentError } = await supabase
      .from("tender_documents")
      .select("id, parser_status, updated_at")
      .eq("tender_id", tenderId)
      .eq("source_url", document.url)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recentDocumentError) throw recentDocumentError;
    const refreshedWithinOneDay = recentDocument?.updated_at
      && Date.now() - new Date(recentDocument.updated_at).getTime() < 24 * 60 * 60 * 1000;
    if (recentDocument?.parser_status === "parsed" && refreshedWithinOneDay) continue;
    if (documentBudget.remaining <= 0) return { downloaded, failed };
    documentBudget.remaining -= 1;

    let prepared: PreparedTenderDocument;
    try {
      prepared = await prepareTenderDocument(document);
    } catch (fetchErr) {
      await createQaTask(supabase, {
        tenderId,
        sourceId: source.id,
        taskType: "parser_failure",
        priority: "medium",
        title: "Tender document could not be fetched and validated",
        details: safeJson({ url: document.url, error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr) })
      });
      failed += 1;
      continue;
    }
    await persistPreparedTenderDocument(supabase, tenderId, payload, source, documentPrefix, prepared);
    downloaded += 1;
  }
  return { downloaded, failed };
}

async function persistPreparedTenderDocument(
  supabase: DatabaseClient,
  tenderId: string,
  payload: RawTenderPayload,
  source: { id: string; adapter_key?: string | null },
  documentPrefix: string,
  prepared: PreparedTenderDocument
): Promise<void> {
  const storagePath = buildTenderDocumentStoragePath({
    adapterKey: source.adapter_key ?? "unknown-source",
    documentPrefix,
    tenderId,
    hash: prepared.hash,
    filename: prepared.filename
  });
  const { error: uploadError } = await supabase.storage.from("tender-documents").upload(storagePath, prepared.buffer, {
    contentType: prepared.contentType,
    upsert: true
  });
  if (uploadError) throw uploadError;

  const { data: tenderDocument, error } = await supabase
    .from("tender_documents")
    .upsert(
      {
        tender_id: tenderId,
        source_url: prepared.document.url,
        storage_path: storagePath,
        original_filename: prepared.filename,
        mime_type: prepared.contentType,
        content_hash: prepared.hash,
        parser_status: "pending",
        ocr_status: "not_needed"
      },
      { onConflict: "tender_id,content_hash" }
    )
    .select("*")
    .single();
  if (error) throw error;

  await supabase
    .from("tender_documents")
    .update({
      page_count: prepared.parsed.pageCount,
      parser_status: prepared.parsed.parserStatus,
      ocr_status: prepared.parsed.ocrStatus
    })
    .eq("id", tenderDocument.id);

  if (prepared.parsed.parserStatus === "failed") {
    await createQaTask(supabase, {
      tenderId,
      sourceId: source.id,
      taskType: "parser_failure",
      priority: "high",
      title: "Tender document parsing failed",
      details: safeJson({
        document_id: tenderDocument.id,
        url: prepared.document.url,
        error: prepared.parsed.errorMessage
      })
    });
    return;
  }

  for (const page of prepared.parsed.pages) {
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

  const documentText = mergeParsedPages(prepared.parsed.pages);
  const documentFields = normalizeDocumentFieldsForSource(
    extractTenderFields(documentText),
    source.adapter_key,
    documentText
  );
  await persistExtractedFields(supabase, tenderId, tenderDocument.id, documentFields);
  await promoteDocumentFieldsToTender(supabase, tenderId, documentFields);
  if (payload.newspaperName && prepared.parsed.ocrStatus === "completed") {
    await createQaTask(supabase, {
      tenderId,
      sourceId: source.id,
      taskType: "manual_verification",
      priority: "medium",
      title: "OCR newspaper tender notice needs verification",
      details: safeJson({
        document_id: tenderDocument.id,
        newspaper: payload.newspaperName,
        confidence: prepared.parsed.pages[0]?.confidenceScore ?? null
      })
    });
  }
}

export function validateDownloadedDocument(input: {
  buffer: Buffer;
  contentType?: string | null | undefined;
  filename?: string | null | undefined;
}): string | null {
  if (!input.buffer.length) return "Downloaded document is empty.";
  const filename = (input.filename ?? "").toLowerCase();
  const contentType = (input.contentType ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const expectsPdf = filename.endsWith(".pdf") || contentType === "application/pdf";
  const expectsJpeg = /\.jpe?g$/.test(filename) || contentType === "image/jpeg" || contentType === "image/jpg";
  const expectsPng = filename.endsWith(".png") || contentType === "image/png";
  const expectsTiff = /\.tiff?$/.test(filename) || contentType === "image/tiff";
  const expectsWebp = filename.endsWith(".webp") || contentType === "image/webp";

  if (contentType === "text/html" || /\.html?$/.test(filename)) {
    return "HTML portal pages are not downloadable tender documents.";
  }

  if (expectsPdf && input.buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    return "Expected a PDF but the response does not have a PDF signature.";
  }
  if (expectsJpeg && !(input.buffer[0] === 0xff && input.buffer[1] === 0xd8 && input.buffer[2] === 0xff)) {
    return "Expected a JPEG but the response does not have a JPEG signature.";
  }
  if (expectsPng && !input.buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "Expected a PNG but the response does not have a PNG signature.";
  }
  if (expectsTiff) {
    const signature = input.buffer.subarray(0, 4).toString("hex");
    if (signature !== "49492a00" && signature !== "4d4d002a") return "Expected a TIFF but the response does not have a TIFF signature.";
  }
  if (expectsWebp && !(input.buffer.subarray(0, 4).toString("ascii") === "RIFF" && input.buffer.subarray(8, 12).toString("ascii") === "WEBP")) {
    return "Expected a WebP image but the response does not have a WebP signature.";
  }
  if ((expectsPdf || expectsJpeg || expectsPng || expectsTiff || expectsWebp) && /^(?:text\/html|application\/json)$/.test(contentType)) {
    return `Expected a binary tender document but received ${contentType}.`;
  }
  return null;
}

function isBinaryTenderDocumentReference(document: RawTenderDocument): boolean {
  const mimeType = (document.mimeType ?? "").toLowerCase();
  const filename = (document.filename ?? new URL(document.url).pathname).toLowerCase();
  return mimeType === "application/pdf"
    || mimeType.includes("wordprocessingml")
    || mimeType.startsWith("image/")
    || /\.(?:pdf|docx|jpe?g|png|tiff?|webp)$/.test(filename);
}

function normalizeDocumentFieldsForSource(
  fields: ExtractedFieldResult[],
  adapterKey: string | null | undefined,
  documentText: string
): ExtractedFieldResult[] {
  let normalizedFields = fields;
  if (adapterKey === "federal-epads") {
    const epadsFields = extractFederalEpadsDocumentFields(documentText);
    const preciseNames = new Set(epadsFields.map((field) => field.fieldName));
    normalizedFields = [...epadsFields, ...fields.filter((field) => !preciseNames.has(field.fieldName))];
  }
  if (adapterKey === "punjab-ppra") {
    const corrections = extractPunjabPpraCorrectionFields(documentText);
    const correctedNames = new Set(corrections.map((field) => field.fieldName));
    normalizedFields = [...corrections, ...fields.filter((field) => !correctedNames.has(field.fieldName))];
  }
  if (adapterKey === "kp-ppra-active") {
    const noticeFields = extractKpPpraNoticeFields(documentText);
    const preciseNames = new Set(noticeFields.map((field) => field.fieldName));
    normalizedFields = [
      ...noticeFields,
      ...fields
        .filter((field) => !preciseNames.has(field.fieldName))
        .map((field) => ["bid_security_amount", "estimated_value", "document_fee"].includes(field.fieldName)
          ? { ...field, confidenceScore: 0.69, verificationStatus: "needs_review" as const }
          : field)
    ];
  }
  if (adapterKey === "federal-epads" || adapterKey === "federal-ppra-active") {
    normalizedFields = appendFederalEstimatedValueLowerBound(normalizedFields);
  }
  if (adapterKey !== "federal-epads" && adapterKey !== "federal-ppra-active" && adapterKey !== "punjab-ppra" && adapterKey !== "kp-ppra-active" && adapterKey !== "balochistan-bppra" && adapterKey !== "sindh-sppra") return normalizedFields;
  return normalizedFields.map((field) => {
    if (field.fieldName !== "closing_date" && field.fieldName !== "opening_date") return field;
    const parsed = new Date(field.fieldValue);
    if (Number.isNaN(parsed.getTime())) return field;
    return {
      ...field,
      fieldValue: new Date(parsed.getTime() - 5 * 60 * 60 * 1000).toISOString()
    };
  });
}

export function appendFederalEstimatedValueLowerBound(fields: ExtractedFieldResult[]): ExtractedFieldResult[] {
  if (fields.some((field) => field.fieldName === "estimated_value" || field.fieldName === "estimated_value_summary")) return fields;
  const securities = fields
    .filter((field) => field.fieldName === "bid_security_amount" && field.confidenceScore >= 0.82 && field.verificationStatus !== "needs_review")
    .map((field) => ({ field, value: Number(field.fieldValue) }))
    .filter((item) => Number.isFinite(item.value) && item.value > 0)
    .sort((left, right) => left.value - right.value);
  const security = securities[0];
  if (!security) return fields;
  const lowerBound = security.value * 20;
  const evidenceText = `Derived lower bound under PPRA Rule 25 (bid security may not exceed 5% of estimated value). ${security.field.evidenceText}`;
  return [
    ...fields,
    {
      fieldName: "estimated_value_lower_bound",
      fieldValue: String(lowerBound),
      sourceMethod: "table_rule",
      confidenceScore: 0.8,
      evidenceText,
      verificationStatus: "unverified"
    },
    {
      fieldName: "estimated_value_summary",
      fieldValue: `At least PKR ${lowerBound.toLocaleString("en-PK")} (Rule 25 lower bound; exact estimate not published)`,
      sourceMethod: "table_rule",
      confidenceScore: 0.8,
      evidenceText,
      verificationStatus: "unverified"
    }
  ];
}

async function promoteDocumentFieldsToTender(
  supabase: DatabaseClient,
  tenderId: string,
  fields: ExtractedFieldResult[]
): Promise<void> {
  const { data: tender, error } = await supabase.from("tenders").select("*").eq("id", tenderId).maybeSingle();
  if (error) throw error;
  if (!tender) return;
  const updates = buildTenderFieldPromotion(tender, fields);
  if (!Object.keys(updates).length) return;
  const { error: updateError } = await supabase.from("tenders").update(updates).eq("id", tenderId);
  if (updateError) throw updateError;
}

export function buildTenderFieldPromotion(
  tender: Record<string, any>,
  fields: ExtractedFieldResult[]
): Record<string, string | number> {
  if (tender.is_human_verified) return {};
  const promotable = new Set([
    "closing_date",
    "opening_date",
    "bid_security_amount",
    "estimated_value",
    "document_fee",
    "province",
    "city"
  ]);
  const updates: Record<string, string | number> = {};
  for (const field of fields) {
    if (!promotable.has(field.fieldName)) continue;
    const existingValue = tender[field.fieldName];
    const replaceApproximatePortalDeadline = field.fieldName === "closing_date"
      && typeof existingValue === "string"
      && existingValue.endsWith("T18:59:59.999Z");
    const replaceAutomatedBidSecurity = field.fieldName === "bid_security_amount"
      && field.sourceMethod === "table_rule"
      && field.confidenceScore >= 0.9;
    if (existingValue !== null && existingValue !== undefined && !replaceApproximatePortalDeadline && !replaceAutomatedBidSecurity) continue;
    if (updates[field.fieldName] !== undefined) continue;
    if (field.confidenceScore < pipelineRuntimeConfig.lowConfidenceFieldThreshold || field.verificationStatus === "needs_review") continue;
    if (["bid_security_amount", "estimated_value", "document_fee"].includes(field.fieldName)) {
      const value = Number(field.fieldValue);
      if (Number.isFinite(value) && value >= 0) updates[field.fieldName] = value;
      continue;
    }
    if (field.fieldValue.trim()) updates[field.fieldName] = field.fieldValue;
  }
  return updates;
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
      // Ambiguous candidates remain separate. Deterministically rejecting the
      // merge avoids silently combining distinct procurements.
      await supabase
        .from("duplicate_candidates")
        .update({ status: "rejected" })
        .eq("tender_id", tender.id)
        .eq("candidate_tender_id", candidate.id);
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
  // Content-addressed storage makes snapshots replay-safe and avoids storing the
  // same source response repeatedly across scheduled runs.
  const storagePath = `${source.id}/${hash}.${extension}`;
  const { error: uploadError } = await supabase.storage.from("tender-source-snapshots").upload(storagePath, body, {
    contentType,
    upsert: true
  });
  if (uploadError) throw uploadError;
  const { error: snapshotError } = await supabase.from("raw_source_snapshots").upsert(
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
  if (snapshotError) throw snapshotError;
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
  const contactEvidence = normalizeWhitespace(payload.contactPerson ?? "");
  const contactEmail = contactEvidence.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0];
  const contactPhone = contactEvidence.match(/(?:\+?92[\s().-]*|0)(?:3\d{2}|\d{2,3})[\s().-]*\d{3,4}[\s.-]*\d{3,4}\b/)?.[0];
  const tenderType = metadataString(sourceMetadataValue(payload.sourceMetadata, "tenderType"))
    ?? metadataString(sourceMetadataValue(payload.sourceMetadata, "tseType"))
    ?? payload.procurementCategory;
  for (const [fieldName, rawFieldValue, confidenceScore] of [
    ["tender_number", payload.tenderNumber, 0.92],
    ["department", payload.department, 0.9],
    ["procurement_category", payload.procurementCategory, 0.9],
    ["advertisement_date", payload.advertisementDate, 0.9],
    ["closing_date", payload.closingDate, 0.9],
    ["opening_date", payload.openingDate, 0.9],
    ["province", payload.province, 0.86],
    ["city", payload.city, 0.86],
    ["bid_security_amount", payload.bidSecurityAmount, 0.9],
    ["estimated_value", payload.estimatedValue, 0.9],
    ["document_fee", payload.documentFee, 0.9],
    ["procurement_method", payload.procurementMethod, 0.82],
    ["submission_method", payload.submissionMethod, 0.82],
    ["tender_type", tenderType, 0.82],
    ["contact_person", payload.contactPerson, 0.82],
    ["contact_email", contactEmail, 0.88],
    ["contact_phone", contactPhone, 0.86],
    ["website_url", payload.websiteUrl, 0.9],
    ["original_source_url", payload.originalSourceUrl ?? payload.sourceUrl, 0.9],
    ["source_status", payload.sourceStatus, 0.9]
  ] as const) {
    const fieldValue = rawFieldValue === undefined || rawFieldValue === null ? undefined : String(rawFieldValue);
    if (!fieldValue) continue;
    fields.push({
      fieldName,
      fieldValue,
      sourceMethod: "html_selector",
      confidenceScore,
      evidenceText: fieldName.startsWith("contact_") && contactEvidence ? contactEvidence : evidence || fieldValue,
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
