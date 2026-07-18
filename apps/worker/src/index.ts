import cron from "node-cron";
import { logger } from "@tenderlo/shared";
import {
  backfillStoredTenderFields,
  closeExpiredTenders,
  ingestAllDueSources,
  ingestSource,
  processQueuedIngestionJobs,
  rebuildRecommendations,
  sendPendingAlerts
} from "./jobs";

const command = process.argv[2] ?? "help";
const argument = process.argv[3];
const secondArgument = process.argv[4];
const thirdArgument = process.argv[5];

async function main(): Promise<void> {
  if (command === "ingest-all") {
    await ingestAllDueSources();
    return;
  }
  if (command === "ingest-source") {
    if (!argument) throw new Error("Usage: npm run worker -- ingest-source <source-id>");
    await ingestSource(argument);
    return;
  }
  if (command === "rebuild-recommendations") {
    await rebuildRecommendations(argument);
    return;
  }
  if (command === "send-alerts") {
    await sendPendingAlerts();
    return;
  }
  if (command === "close-expired") {
    await closeExpiredTenders();
    return;
  }
  if (command === "process-ingestion-queue") {
    await processQueuedIngestionJobs();
    return;
  }
  if (command === "backfill-fields") {
    await backfillStoredTenderFields(argument, secondArgument, Number(thirdArgument ?? 0));
    return;
  }
  if (command === "schedule") {
    cron.schedule("*/1 * * * *", () => {
      ingestAllDueSources().catch((error) => logger.error("Scheduled ingestion failed.", { error: error instanceof Error ? error.message : String(error) }));
    });
    cron.schedule("*/30 * * * *", () => {
      sendPendingAlerts().catch((error) => logger.error("Scheduled alerts failed.", { error: error instanceof Error ? error.message : String(error) }));
    });
    cron.schedule("15 * * * *", () => {
      closeExpiredTenders().catch((error) => logger.error("Scheduled tender closure failed.", { error: error instanceof Error ? error.message : String(error) }));
    });
    // HIGH-04: rebuild recommendations daily at 02:15 UTC so scores are never permanently stale
    cron.schedule("15 2 * * *", () => {
      rebuildRecommendations().catch((error) => logger.error("Scheduled recommendation rebuild failed.", { error: error instanceof Error ? error.message : String(error) }));
    });
    // LOW-02: graceful shutdown so ingestion_runs are not stuck in "running"
    const shutdown = (): void => {
      logger.info("TenderLo worker shutting down.");
      process.exit(0);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
    logger.info("TenderLo worker scheduler is running.");
    return;
  }

  logger.info(`TenderLo worker commands:
  ingest-all
  ingest-source <source-id>
  process-ingestion-queue
  rebuild-recommendations [organization-id]
  send-alerts
  close-expired
  backfill-fields [source-id] [tender-id|all] [start-offset]
  schedule`);
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message
    : (typeof error === "object" && error !== null && "message" in error) ? String((error as any).message)
    : typeof error === "string" ? error
    : JSON.stringify(error);
  logger.error("TenderLo worker command failed.", { error: msg, raw: typeof error === "object" ? JSON.stringify(error)?.slice(0, 200) : undefined });
  process.exitCode = 1;
});
