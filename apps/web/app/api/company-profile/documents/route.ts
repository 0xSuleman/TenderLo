import { randomUUID } from "node:crypto";
import { calculateProfileCompleteness, writeAuditLog } from "@tenderlo/db";
import { created, fail } from "@/lib/api";
import { requireOrgRoleFromRequest } from "@/lib/supabase";

export async function POST(request: Request): Promise<Response> {
  try {
    const { admin, organizationId, user } = await requireOrgRoleFromRequest(request, ["owner", "admin", "member", "ops_admin"]);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Document upload requires a file field.");
    const documentType = String(form.get("document_type") ?? "other");
    const expiryDate = form.get("expiry_date") ? String(form.get("expiry_date")) : null;
    const buffer = Buffer.from(await file.arrayBuffer());
    const storagePath = `${organizationId}/${randomUUID()}-${file.name}`;
    const upload = await admin.storage.from("profile-documents").upload(storagePath, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false
    });
    if (upload.error) throw upload.error;
    const { data, error } = await admin
      .from("profile_documents")
      .insert({
        organization_id: organizationId,
        document_type: documentType,
        storage_path: storagePath,
        original_filename: file.name,
        mime_type: file.type || "application/octet-stream",
        expiry_date: expiryDate,
        uploaded_by: user.id
      })
      .select("*")
      .single();
    if (error) throw error;
    await calculateProfileCompleteness(admin, organizationId);
    await writeAuditLog(admin, {
      organizationId,
      actorUserId: user.id,
      action: "profile_document.uploaded",
      entityType: "profile_document",
      entityId: data.id,
      newValue: { document_type: documentType, storage_path: storagePath }
    });
    return created(data);
  } catch (error) {
    return fail(error);
  }
}
