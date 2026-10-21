import nodemailer from "nodemailer";
import { config, isProd } from "./config";

const transport = config.SMTP_HOST
  ? nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    })
  : null;

export const outbox: { to: string; subject: string; text: string }[] = [];

export async function sendMail(to: string, subject: string, text: string) {
  if (transport) {
    await transport.sendMail({ from: config.MAIL_FROM, to, subject, text });
    return;
  }
  if (isProd) throw new Error("SMTP is not configured");
  outbox.push({ to, subject, text });
  if (outbox.length > 50) outbox.shift();
  if (config.NODE_ENV !== "test") console.log(`[mail] to=${to} subject="${subject}"\n${text}`);
}
