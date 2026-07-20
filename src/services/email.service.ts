import nodemailer from "nodemailer";
import sgMail from "@sendgrid/mail";
import { env } from "../config/env.js";

// Initialize SendGrid if API key is available
if (env.sendgridApiKey) {
  sgMail.setApiKey(env.sendgridApiKey);
}

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

  // Try SendGrid first if configured
  if (env.sendgridApiKey && env.sendgridFromEmail) {
    try {
      const [response] = await sgMail.send({
        to,
        from: env.sendgridFromEmail,
        subject,
        html
      });
      return { sent: true, messageId: String(response.headers["x-message-id"] || ""), error: null };
    } catch (e: any) {
      console.error(`[SENDGRID ERROR] to=${to} subject=${subject} error=${e?.message || "unknown"}`);
      // Fall through to SMTP if SendGrid fails and SMTP is available
    }
  }

  const hasSmtp =
    Boolean(env.smtpHost) &&
    Boolean(env.smtpPort) &&
    Boolean(env.smtpUser) &&
    Boolean(env.smtpPass) &&
    Boolean(env.smtpFrom);

  if (!hasSmtp) {
    console.log(`[EMAIL MOCK] to=${to} subject=${subject}`);
    return { sent: false, messageId: null, error: "email_not_configured" };
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
