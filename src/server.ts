import http from "http";
import app from "./app.js";
import { connectToDatabase } from "./config/db.js";
import { env } from "./config/env.js";
import { processDueAdminNotificationEmailBatches } from "./services/adminNotifications.service.js";
import { scheduleFridayPayouts } from "./services/payoutScheduler.service.js";
import { startTrackingPoller } from "./services/trackingPoller.service.js";

/**
 * Last-resort guards.
 *
 * A dependency once took the entire API down: `pdf-node` rejected on a promise
 * it never handled, so downloading an invoice surfaced an unhandled rejection
 * and Node exited — for every user, not just the one who clicked. The calling
 * code's try/catch could not intercept it.
 *
 * That library is gone, but the shape of the failure is what matters: a fault
 * inside a third-party package should degrade one request, never kill the
 * process. These log loudly and keep serving.
 *
 * Deliberately not a blanket "ignore errors" — anything landing here is a real
 * defect that needs fixing, and the stack is printed in full so it is findable
 * rather than silently swallowed.
 */
process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED_REJECTION] a promise rejected with no handler — the server is still running, but this is a bug:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[UNCAUGHT_EXCEPTION] the server is still running, but this is a bug:", error);
});

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
