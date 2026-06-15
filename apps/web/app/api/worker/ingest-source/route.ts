import { z } from "zod";
import { ingestSource } from "@tenderlo/worker/jobs";
import { assertWorkerSecret } from "@tenderlo/notifications";
import { created, fail, parseBody } from "@/lib/api";

const ingestSchema = z.object({
  source_id: z.string().uuid()
});

export async function POST(request: Request): Promise<Response> {
  try {
    assertWorkerSecret(request.headers.get("x-worker-secret"));
    const input = await parseBody(request, ingestSchema);
    await ingestSource(input.source_id);
    return created({ source_id: input.source_id, status: "ingested" });
  } catch (error) {
    return fail(error);
  }
}
