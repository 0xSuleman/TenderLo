import { NextResponse } from "next/server";
import { createSignedUrl } from "@tenderlo/db";
import { ForbiddenError } from "@tenderlo/shared";
import { fail } from "@/lib/api";
import { createSupabaseAdminClient, requireOrgContext } from "@/lib/supabase";
import { hasActiveTenderPlan } from "@/lib/tender-search";

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  try {
    const { path } = await context.params;
    const storagePath = path.join("/");
    const orgContext = await requireOrgContext(request);
    const admin = createSupabaseAdminClient();
    const hasPaidAccess = orgContext.isOps || await hasActiveTenderPlan(admin, orgContext.organizationId);
    if (!hasPaidAccess) throw new ForbiddenError("An active TenderLo plan is required to download tender documents.");

    const { data: document, error: documentError } = await admin
      .from("tender_documents")
      .select("id,tender_id,storage_path")
      .eq("storage_path", storagePath)
      .maybeSingle();
    if (documentError) throw documentError;
    if (!document) throw new Error("Tender document not found.");

    const { data: tender, error: tenderError } = await admin.from("tenders").select("status").eq("id", document.tender_id).maybeSingle();
    if (tenderError) throw tenderError;
    if (!tender || (!orgContext.isOps && !["published", "closed", "cancelled", "corrigendum"].includes(tender.status))) {
      throw new ForbiddenError("Tender document is not available.");
    }

    const signedUrl = await createSignedUrl(admin, "tender-documents", document.storage_path, 300);
    return NextResponse.redirect(signedUrl);
  } catch (error) {
    return fail(error);
  }
}
