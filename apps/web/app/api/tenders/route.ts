import { NextResponse } from "next/server";
import { AppError, tenderSearchSchema } from "@tenderlo/shared";
import { fail, readSearchParams } from "@/lib/api";
import { createSupabaseAdminClient, requireOrgContext } from "@/lib/supabase";
import { hasActiveTenderPlan, searchTenders } from "@/lib/tender-search";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const tenderSearchBuckets = new Map<string, { count: number; resetAt: number }>();

export async function GET(request: Request): Promise<Response> {
  try {
    enforceTenderSearchRateLimit(request);
    const input = readSearchParams(request, tenderSearchSchema);
    const admin = createSupabaseAdminClient();
    let organizationId: string | undefined;
    let isOps = false;
    let hasPremium = false;
    try {
      const context = await requireOrgContext(request);
      organizationId = context.organizationId;
      isOps = context.isOps;
      hasPremium = await hasActiveTenderPlan(admin, context.organizationId);
    } catch {
      hasPremium = false;
    }
    const result = await searchTenders(admin, input, { organizationId, isOps, hasPaidAccess: hasPremium });
    return NextResponse.json(result);
  } catch (error) {
    return fail(error);
  }
}

function enforceTenderSearchRateLimit(request: Request): void {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const key = forwardedFor || request.headers.get("x-real-ip") || "local";
  const now = Date.now();
  const bucket = tenderSearchBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    tenderSearchBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return;
  }
  if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) {
    throw new AppError("Too many tender search requests. Try again in a minute.", 429, "RATE_LIMITED", true);
  }
  bucket.count += 1;
}
