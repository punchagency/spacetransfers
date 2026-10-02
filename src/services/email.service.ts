import { env } from "../config/env.js";

export type EmailResult = { sent: boolean; messageId: string | null; error: string | null };
type Message = { to: string; subject: string; html: string };

const RESEND_URL = "https://api.resend.com/emails";
/** An email is never worth holding a request open for long. */
const RESEND_TIMEOUT_MS = 15_000;

/**
 * One message through Resend's API.
 *
 * Resend replaced SendGrid: it is the provider the client is opening an account
 * with, and the only place our ask and our code disagreed. Plain `fetch` rather
 * than an SDK — it is one JSON POST — and it never throws: a failed email is
 * reported in the result, never allowed to fail the request that sent it.
 * `fetchImpl` is only there for the tests.
 */
export const sendViaResend = async (
  message: Message,
  config: { apiKey: string; from: string },
  fetchImpl: typeof fetch = fetch,
): Promise<EmailResult> => {
  try {
    const response = await fetchImpl(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: config.from, to: message.to, subject: message.subject, html: message.html }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
    const body: any = await response.json().catch(() => null);
    if (!response.ok) {
      const reason = `Resend ${response.status}: ${body?.message || body?.name || response.statusText || "request failed"}`;
      console.error(`[RESEND ERROR] to=${message.to} subject=${message.subject} error=${reason}`);
      return { sent: false, messageId: null, error: reason };
    }
    return { sent: true, messageId: body?.id ? String(body.id) : null, error: null };
  } catch (e: any) {
    const reason =
      e?.name === "TimeoutError" || e?.name === "AbortError"
        ? `Resend did not respond within ${RESEND_TIMEOUT_MS / 1000}s`
        : `Resend request failed: ${e?.message || "unknown error"}`;
    console.error(`[RESEND ERROR] to=${message.to} subject=${message.subject} error=${reason}`);
    return { sent: false, messageId: null, error: reason };
  }
};

export const sendEmail = async ({
  to,
  subject,
  html
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<EmailResult> => {
  if (env.nodeEnv === "test") {
    console.log(`[EMAIL MOCK] to=${to} subject=${subject}`);
    return { sent: false, messageId: null, error: null };
  }

  if (!env.resendApiKey || !env.resendFromEmail) {
    // Not set up yet: say so plainly rather than pretending it was sent.
    console.log(`[EMAIL NOT SENT — Resend is not configured] to=${to} subject=${subject}`);
    return { sent: false, messageId: null, error: "email_not_configured" };
  }

  return sendViaResend({ to, subject, html }, { apiKey: env.resendApiKey, from: env.resendFromEmail });
};
