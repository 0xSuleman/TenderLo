import { z } from "zod";
import { sendNotification } from "@tenderlo/notifications";
import { created, fail, parseBody } from "@/lib/api";
import { requireOrgRoleFromRequest } from "@/lib/supabase";

const whatsappTestSchema = z.object({
  to: z.string().min(8),
  template: z.string().optional()
});

export async function POST(request: Request): Promise<Response> {
  try {
    const { organizationId, user } = await requireOrgRoleFromRequest(request, ["owner", "admin", "ops_admin"]);
    const input = await parseBody(request, whatsappTestSchema);
    const result = await sendNotification({
      organizationId,
      userId: user.id,
      channel: "whatsapp",
      type: "whatsapp_test",
      title: "TenderLo WhatsApp test",
      body: "WhatsApp alerts are configured for this contractor workspace.",
      to: input.to,
      metadata: { template: input.template }
    });
    return created(result);
  } catch (error) {
    return fail(error);
  }
}
