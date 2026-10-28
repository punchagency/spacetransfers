import http from "http";
import mongoose from "mongoose";
import app from "./app.js";
import { connectToDatabase } from "./config/db.js";
import { env } from "./config/env.js";
import { processDueAdminNotificationEmailBatches } from "./services/adminNotifications.service.js";
import { scheduleFridayPayouts } from "./services/payoutScheduler.service.js";
import { startTrackingPoller } from "./services/trackingPoller.service.js";
import { startSlaMonitor } from "./services/slaMonitor.service.js";
import { startWaitingOrderSweep } from "./services/orderAssignment.service.js";
import { startBackupSchedule } from "./services/backup.service.js";
import { startCancellationEscalation } from "./services/cancellationRequest.service.js";
import { initMonitoring, reportServerError } from "./services/monitoring.service.js";
import { startPaymentReconciliation } from "./services/paymentReconciliation.service.js";

process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED_REJECTION] a promise rejected with no handler — the server is still running, but this is a bug:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[UNCAUGHT_EXCEPTION] the server is still running, but this is a bug:", error);
});

const start = async (): Promise<void> => {
  await initMonitoring();
  process.on("unhandledRejection", (reason) => reportServerError(reason, { route: "unhandledRejection" }));
  const server = http.createServer(app);

  server.listen(env.port, () => {
    console.log(`space-transfer-server listening on port ${env.port}`);
  });

  // A deploy stops the old process with SIGTERM, which Node ignores unless it
  // is handled; the host would then wait out its timeout and kill the process
  // mid-request. Requests in progress finish here. Open event streams never end
  // by themselves, so the process exits after 10s regardless.
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[SHUTDOWN] ${signal}: finishing open requests`);
    setTimeout(() => process.exit(0), 10_000).unref();
    server.close(() => {
      mongoose.connection
        .close()
        .catch(() => {})
        .finally(() => process.exit(0));
    });
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));

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

    // Checks parcels with the carrier, as a backup to EasyPost's tracking webhooks.
    startTrackingPoller();

    // Start the SLA monitor. It reads its settings on every pass and does
    // nothing at all until an operator enables it in the console, so starting
    // it here does not begin moving jobs.
    startSlaMonitor();

    // Reports any card payment that has no order (checkout closed mid-way, or
    // the order was refused after the charge).
    startPaymentReconciliation();

    // Retries orders still waiting for a partner; idle while assignment is manual.
    startWaitingOrderSweep();
    startBackupSchedule();
    startCancellationEscalation();
  }
};

start().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
