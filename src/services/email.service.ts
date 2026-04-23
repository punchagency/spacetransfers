import nodemailer from "nodemailer";
import { env } from "../config/env.js";

export const sendEmail = async ({
  to,
  subject,
  html
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ sent: boolean; messageId: string | null; error: string | null }> => {
  if (env.nodeEnv === "test") {
    console.log(`[EMAIL MOCK] to=${to} subject=${subject}`);
    return { sent: false, messageId: null, error: null };
  }

  const hasSmtp =
    Boolean(env.smtpHost) &&
    Boolean(env.smtpPort) &&
    Boolean(env.smtpUser) &&
    Boolean(env.smtpPass) &&
    Boolean(env.smtpFrom);

  if (!hasSmtp) {
    console.log(`[EMAIL MOCK] to=${to} subject=${subject}`);
    return { sent: false, messageId: null, error: "smtp_not_configured" };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort!,
      secure: env.smtpSecure ?? env.smtpPort === 465,
      auth: {
        user: env.smtpUser,
        pass: env.smtpPass
      }
    });

    const info = await transporter.sendMail({
      from: env.smtpFrom,
      to,
      subject,
      html
    });

    return { sent: true, messageId: info?.messageId ? String(info.messageId) : null, error: null };
  } catch (e: any) {
    const message = e?.message ? String(e.message) : "email_send_failed";
    console.error(`[EMAIL ERROR] to=${to} subject=${subject} error=${message}`);
    return { sent: false, messageId: null, error: message };
  }
};
