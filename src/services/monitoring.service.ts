/**
 * Error reporting to Sentry, switched on by SENTRY_DSN. Without it nothing is
 * loaded. Reports carry the error, the route and the status, never request
 * bodies, headers or the session: those can hold passwords and tokens.
 */
let sentry: typeof import("@sentry/node") | null = null;

export const initMonitoring = async () => {
  const dsn = String(process.env.SENTRY_DSN || "").trim();
  if (!dsn || sentry) return;
  try {
    const Sentry = await import("@sentry/node");
    Sentry.init({
      dsn,
      // SENTRY_ENVIRONMENT tells the demo's reports from production's, which
      // both run with NODE_ENV=production.
      environment: String(process.env.SENTRY_ENVIRONMENT || "").trim() || process.env.NODE_ENV || "development",
      sendDefaultPii: false,
      beforeSend: (event) => {
        if (event.request) {
          delete event.request.data;
          delete event.request.headers;
          delete event.request.cookies;
          if (event.request.query_string) event.request.query_string = "[removed]";
        }
        delete event.user;
        return event;
      },
    });
    sentry = Sentry;
    console.log("[MONITORING] error reporting is on");
  } catch (err: any) {
    console.warn(`[MONITORING] could not start: ${err?.message}`);
  }
};

export const reportServerError = (error: unknown, context: { method?: string; route?: string; status?: number } = {}) => {
  try {
    sentry?.captureException(error, { tags: { method: context.method, route: context.route, status: String(context.status ?? "") } });
  } catch {
    // ignore
  }
};
