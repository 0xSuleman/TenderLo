import { createClient } from "@supabase/supabase-js";
import {
  type CompanyProfileSnapshot,
  ForbiddenError,
  type ContractorSector,
  type Json,
  NotFoundError,
  type PecCategory,
  type UserRole,
  isExpired,
  profileCompletenessConfig,
  requiredEnv,
  safeJson
} from "@tenderlo/shared";

export type DatabaseClient = any;

export function createServiceClient(): DatabaseClient {
  return createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }) as DatabaseClient;
}

export function createAnonClient(accessToken?: string): DatabaseClient {
  const options: Record<string, unknown> = {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  };
  if (accessToken) {
    options.global = {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    };
  }
  const client = createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), options) as DatabaseClient;
  return client;
}

export async function getActiveMembership(
  supabase: DatabaseClient,
  userId: string,
  organizationId?: string
): Promise<{ id: string; organization_id: string; user_id: string; role: UserRole; status: string }> {
  let query = supabase
    .from("memberships")
    .select("id, organization_id, user_id, role, status")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1);

  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("Authenticated user does not belong to an active organization.");
  return data as { id: string; organization_id: string; user_id: string; role: UserRole; status: string };
}

export async function requireRole(
  supabase: DatabaseClient,
  userId: string,
  organizationId: string,
  allowed: UserRole[]
): Promise<void> {
  const membership = await getActiveMembership(supabase, userId, organizationId);
  if (!allowed.includes(membership.role)) {
    throw new ForbiddenError();
  }
}

export async function isOpsAdmin(supabase: DatabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .eq("role", "ops_admin")
    .limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}

export async function writeAuditLog(
  supabase: DatabaseClient,
  input: {
    organizationId?: string | null;
    actorUserId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    oldValue?: unknown;
    newValue?: unknown;
    ipAddress?: string | null;
    userAgent?: string | null;
  }
): Promise<void> {
  const { error } = await supabase.from("audit_logs").insert({
    organization_id: input.organizationId ?? null,
    actor_user_id: input.actorUserId ?? null,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    old_value: input.oldValue === undefined ? null : safeJson(input.oldValue),
    new_value: input.newValue === undefined ? null : safeJson(input.newValue),
    ip_address: input.ipAddress ?? null,
    user_agent: input.userAgent ?? null
  });
  if (error) throw error;
}

export async function createQaTask(
  supabase: DatabaseClient,
  input: {
    organizationId?: string | null;
    tenderId?: string | null;
    sourceId?: string | null;
    taskType: "low_confidence_field" | "duplicate_review" | "source_failure" | "parser_failure" | "manual_verification";
    priority?: "low" | "medium" | "high" | "urgent";
    title: string;
    details?: Json;
  }
): Promise<void> {
  let existingQuery = supabase
    .from("qa_tasks")
    .select("id")
    .eq("task_type", input.taskType)
    .eq("title", input.title)
    .in("status", ["open", "in_progress"])
    .limit(1);

  existingQuery = input.organizationId === undefined || input.organizationId === null
    ? existingQuery.is("organization_id", null)
    : existingQuery.eq("organization_id", input.organizationId);
  existingQuery = input.tenderId === undefined || input.tenderId === null
    ? existingQuery.is("tender_id", null)
    : existingQuery.eq("tender_id", input.tenderId);
  existingQuery = input.sourceId === undefined || input.sourceId === null
    ? existingQuery.is("source_id", null)
    : existingQuery.eq("source_id", input.sourceId);

  const { data: existing, error: existingError } = await existingQuery;
  if (!existingError && existing?.length) return;

  const { error } = await supabase.from("qa_tasks").insert({
    organization_id: input.organizationId ?? null,
    tender_id: input.tenderId ?? null,
    source_id: input.sourceId ?? null,
    task_type: input.taskType,
    priority: input.priority ?? "medium",
    title: input.title,
    details: input.details ?? {}
  });
  if (error) throw error;
}

export async function calculateProfileCompleteness(supabase: DatabaseClient, organizationId: string): Promise<number> {
  const [{ data: company }, { data: pec }, { data: engineers }, { data: equipment }, { data: docs }] = await Promise.all([
    supabase.from("company_profiles").select("*").eq("organization_id", organizationId).maybeSingle(),
    supabase.from("pec_licenses").select("*").eq("organization_id", organizationId).limit(1),
    supabase.from("engineers").select("id").eq("organization_id", organizationId),
    supabase.from("equipment").select("id").eq("organization_id", organizationId),
    supabase.from("profile_documents").select("document_type, verification_status").eq("organization_id", organizationId)
  ]);

  let score = 0;
  if (company?.business_type) score += profileCompletenessConfig.companyBusinessType;
  if (company?.ntn) score += profileCompletenessConfig.companyNtn;
  if (company?.operating_regions?.length) score += profileCompletenessConfig.operatingRegions;
  if (company?.sectors?.length) score += profileCompletenessConfig.sectors;
  if (pec?.length) score += profileCompletenessConfig.pecLicense;
  if (engineers?.length) score += profileCompletenessConfig.engineers;
  if (equipment?.length) score += profileCompletenessConfig.equipment;

  const documentTypes = new Set((docs ?? []).map((doc: { document_type: string }) => doc.document_type));
  for (const documentType of profileCompletenessConfig.profileDocuments) {
    if (documentTypes.has(documentType)) score += profileCompletenessConfig.profileDocument;
  }

  const finalScore = Math.min(profileCompletenessConfig.maxScore, score);
  await supabase.from("company_profiles").update({ profile_completeness_score: finalScore }).eq("organization_id", organizationId);
  return finalScore;
}

export async function buildCompanyProfileSnapshot(
  supabase: DatabaseClient,
  organizationId: string
): Promise<CompanyProfileSnapshot> {
  const [{ data: company }, { data: pecRows }, { data: docs }, { data: engineers }, { data: equipmentRows }] = await Promise.all([
    supabase.from("company_profiles").select("*").eq("organization_id", organizationId).maybeSingle(),
    supabase.from("pec_licenses").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("profile_documents").select("document_type, verification_status, expiry_date").eq("organization_id", organizationId),
    supabase.from("engineers").select("discipline, verification_status, expiry_date").eq("organization_id", organizationId),
    supabase.from("equipment").select("id").eq("organization_id", organizationId)
  ]);

  const pec = (pecRows?.[0] ?? {}) as { category?: PecCategory; specialization_codes?: string[] };
  return {
    organizationId,
    sectors: ((company?.sectors ?? []) as ContractorSector[]) ?? [],
    operatingRegions: (company?.operating_regions ?? []) as string[],
    pecCategory: pec.category ?? "unknown",
    specializationCodes: pec.specialization_codes ?? [],
    documents: (docs ?? []).map((doc: { document_type: string; verification_status: string; expiry_date: string | null }) => ({
      documentType: doc.document_type,
      verificationStatus: isExpired(doc.expiry_date) ? "expired" : (doc.verification_status as never),
      expiryDate: doc.expiry_date
    })),
    engineers: (engineers ?? []).map((engineer: { discipline: string | null; verification_status: string; expiry_date: string | null }) => ({
      discipline: engineer.discipline,
      verificationStatus: isExpired(engineer.expiry_date) ? "expired" : (engineer.verification_status as never),
      expiryDate: engineer.expiry_date
    })),
    equipmentCount: equipmentRows?.length ?? 0
  };
}

export async function createSignedUrl(
  supabase: DatabaseClient,
  bucket: string,
  path: string,
  expiresInSeconds = 600
): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}
