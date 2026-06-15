import { createHash, randomBytes } from "node:crypto";
import { invitationCreateSchema } from "@tenderlo/shared";
import { sendNotification } from "@tenderlo/notifications";
import { created, fail, parseBody } from "@/lib/api";
import { requireOrgRoleFromRequest } from "@/lib/supabase";
import { writeAuditLog } from "@tenderlo/db";

export async function POST(request: Request): Promise<Response> {
  try {
    const { admin, organizationId, user } = await requireOrgRoleFromRequest(request, ["owner", "admin", "ops_admin"]);
    const input = await parseBody(request, invitationCreateSchema);
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const { data, error } = await admin
      .from("invitations")
      .insert({
        organization_id: organizationId,
        email: input.email,
        role: input.role,
        token_hash: tokenHash,
        expires_at: expiresAt,
        created_by: user.id
      })
      .select("*")
      .single();
    if (error) throw error;
    await sendNotification({
      organizationId,
      userId: null,
      channel: "email",
      type: "team_invitation",
      title: "You have been invited to TenderLo",
      body: `Use this invitation token to join the contractor workspace: ${token}. The invitation expires on ${expiresAt}.`,
      to: input.email
    }).catch(() => ({ status: "failed" as const }));
    await writeAuditLog(admin, {
      organizationId,
      actorUserId: user.id,
      action: "invitation.created",
      entityType: "invitation",
      entityId: data.id,
      newValue: { email: input.email, role: input.role }
    });
    return created({ invitation: data });
  } catch (error) {
    return fail(error);
  }
}
