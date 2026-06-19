import http from "http";
import app from "./app.js";
import { connectToDatabase } from "./config/db.js";
import { env } from "./config/env.js";
import { processDueAdminNotificationEmailBatches } from "./services/adminNotifications.service.js";
import { scheduleFridayPayouts } from "./services/payoutScheduler.service.js";
import { startTrackingPoller } from "./services/trackingPoller.service.js";

const start = async (): Promise<void> => {
  const server = http.createServer(app);

  server.listen(env.port, () => {
    console.log(`space-transfer-server listening on port ${env.port}`);
  });

  const tryConnect = async () => {
    try {
      await connectToDatabase();
    } catch {
      if (env.nodeEnv !== "test") {
        console.error("[DB] Initial connection failed. Retrying in 5s…");
      }
      setTimeout(() => {
        tryConnect().catch(() => {});
      }, 5000);
    }
  };

  await tryConnect();

  if (env.nodeEnv !== "test") {
    setInterval(() => {
      processDueAdminNotificationEmailBatches().catch(() => {});
    }, 10_000);

    // Start Friday payout scheduler (TEST MODE ONLY)
    scheduleFridayPayouts();

    // Start ShipStation tracking poller (SHIPPED → COMPLETED on delivery confirmation)
    startTrackingPoller();
  }
};

start().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
