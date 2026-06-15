import { calculateProfileCompleteness, writeAuditLog } from "@tenderlo/db";
import { fail, noContent } from "@/lib/api";
import { requireOrgRoleFromRequest } from "@/lib/supabase";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const { admin, organizationId, user } = await requireOrgRoleFromRequest(request, ["owner", "admin", "member", "ops_admin"]);
    const { data: doc, error: loadError } = await admin.from("profile_documents").select("*").eq("id", id).eq("organization_id", organizationId).single();
    if (loadError) throw loadError;
    await admin.storage.from("profile-documents").remove([doc.storage_path]);
    const { error } = await admin.from("profile_documents").delete().eq("id", id).eq("organization_id", organizationId);
    if (error) throw error;
    await calculateProfileCompleteness(admin, organizationId);
    await writeAuditLog(admin, {
      organizationId,
      actorUserId: user.id,
      action: "profile_document.deleted",
      entityType: "profile_document",
      entityId: id,
      oldValue: doc
    });
    return noContent();
  } catch (error) {
    return fail(error);
  }
}
