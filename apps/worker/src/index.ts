import cron from "node-cron";
import { logger } from "@tenderlo/shared";
import {
  closeExpiredTenders,
  ingestAllDueSources,
  ingestSource,
  rebuildRecommendations,
  sendPendingAlerts
} from "./jobs";

const command = process.argv[2] ?? "help";
const argument = process.argv[3];

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
  if (command === "schedule") {
    cron.schedule("*/15 * * * *", () => {
      ingestAllDueSources().catch((error) => logger.error("Scheduled ingestion failed.", { error: error instanceof Error ? error.message : String(error) }));
    });
    cron.schedule("*/30 * * * *", () => {
      sendPendingAlerts().catch((error) => logger.error("Scheduled alerts failed.", { error: error instanceof Error ? error.message : String(error) }));
    });
    cron.schedule("15 * * * *", () => {
      closeExpiredTenders().catch((error) => logger.error("Scheduled tender closure failed.", { error: error instanceof Error ? error.message : String(error) }));
    });
    logger.info("TenderLo worker scheduler is running.");
    return;
  }

  logger.info(`TenderLo worker commands:
  ingest-all
  ingest-source <source-id>
  rebuild-recommendations [organization-id]
  send-alerts
  close-expired
  schedule`);
}

main().catch((error) => {
  logger.error("TenderLo worker command failed.", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
