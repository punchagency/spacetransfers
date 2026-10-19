/**
 * Error reporting to Sentry, switched on by VITE_SENTRY_DSN at build time.
 * Without it nothing is loaded and nothing leaves the browser. Reports carry
 * the error and the page, not the person: no names, emails, typed text or
 * sign-in tokens.
 */
const DSN = (import.meta.env.VITE_SENTRY_DSN || "").trim();
let sentry: typeof import("@sentry/browser") | null = null;

export const initMonitoring = async (app: string) => {
  if (!DSN || sentry) return;
  try {
    const Sentry = await import("@sentry/browser");
    Sentry.init({
      dsn: DSN,
      environment: import.meta.env.MODE,
      sendDefaultPii: false,
      initialScope: { tags: { app } },
      beforeSend: (event) => {
        if (event.request) delete event.request.cookies;
        if (event.request?.url) event.request.url = scrubUrl(event.request.url);
        delete event.user;
        return event;
      },
    });
    sentry = Sentry;
  } catch {
    // Monitoring must never break the page.
  }
};

/** Removes tokens that can ride in an address: reset links, sign-in steps. */
export const scrubUrl = (url: string) => url.replace(/([?&](?:token|resetToken|inviteToken|stepToken)=)[^&#]*/gi, "$1[removed]");

export const reportError = (error: unknown, context?: Record<string, unknown>) => {
  try {
    sentry?.captureException(error, context ? { extra: context } : undefined);
  } catch {
    // ignore
  }
};
