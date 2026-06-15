import { sendPendingAlerts } from "@tenderlo/worker/jobs";
import { assertWorkerSecret } from "@tenderlo/notifications";
import { created, fail } from "@/lib/api";

export async function POST(request: Request): Promise<Response> {
  try {
    assertWorkerSecret(request.headers.get("x-worker-secret"));
    await sendPendingAlerts();
    return created({ status: "alerts_sent" });
  } catch (error) {
    return fail(error);
  }
}
