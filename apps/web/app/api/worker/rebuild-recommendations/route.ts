import { z } from "zod";
import { rebuildRecommendations } from "@tenderlo/worker/jobs";
import { assertWorkerSecret } from "@tenderlo/notifications";
import { created, fail, parseBody } from "@/lib/api";

const rebuildSchema = z.object({
  organization_id: z.string().uuid().optional()
});

export async function POST(request: Request): Promise<Response> {
  try {
    assertWorkerSecret(request.headers.get("x-worker-secret"));
    const input = await parseBody(request, rebuildSchema);
    await rebuildRecommendations(input.organization_id);
    return created({ organization_id: input.organization_id ?? null, status: "rebuilt" });
  } catch (error) {
    return fail(error);
  }
}
