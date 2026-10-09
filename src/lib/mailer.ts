import nodemailer from "nodemailer";
import type { SMTPPoolOptions } from "nodemailer";

import { env } from "../config/env.js";
import { logger } from "./logger.js";

/**
 * Outgoing e-mail (PD-013). Delivery is active only when SMTP_HOST and SMTP_FROM are configured;
 * SMTP_HOST=log renders mails into the log instead of sending them (development).
 * Never logs credentials; bodies are logged only in log mode.
 */

export type MailMessage = { to: string; subject: string; text: string; html: string };
export type MailResult = { mode: "smtp" | "log"; messageId: string | null };

type MailConfig = { SMTP_HOST?: string | undefined; SMTP_FROM?: string | undefined };

/** Pure check behind isEmailEnabled (unit-tested). */
export const emailConfigured = (config: MailConfig) => Boolean(config.SMTP_HOST && config.SMTP_FROM);

export const isEmailEnabled = () => emailConfigured(env);

export const isEmailLogMode = () => env.SMTP_HOST === "log";

/** Retrying cannot fix it for this message (e.g. the recipient address does not exist). */
export class PermanentMailError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "PermanentMailError";
    this.code = code;
  }
}

type SmtpErrorShape = { code?: unknown; responseCode?: unknown; command?: unknown };

/**
 * Permanent: the server rejected the recipient with a 5xx reply, or the message itself was refused
 * (EMESSAGE). Everything else (connection, TLS, auth, 4xx, sender/config problems) is transient and
 * retried — a config error then parks in the dead-letter queue instead of silently dropping mail.
 */
export const isPermanentMailError = (error: unknown) => {
  if (error instanceof PermanentMailError) {
    return true;
  }
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const { code, responseCode, command } = error as SmtpErrorShape;
  if (code === "EMESSAGE") {
    return true;
  }
  return code === "EENVELOPE" && command === "RCPT TO" && typeof responseCode === "number" && responseCode >= 500;
};

// Same shape as the app_users.email CHECK constraint.
const addressPattern = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
export const isDeliverableAddress = (address: string) => address.length <= 254 && addressPattern.test(address);

/** Header-safe subject: one line, bounded length. */
export const toSubjectLine = (subject: string) => {
  const line = subject.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
};

const maskAddress = (address: string) => {
  const [local = "", domain = ""] = address.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
};

const createTransport = () => {
  const secure = env.SMTP_SECURE ?? env.SMTP_PORT === 465;
  const options: SMTPPoolOptions & { pool: true } = {
    pool: true,
    maxConnections: 2,
    maxMessages: 100,
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure,
    // Credentials never travel in clear text: without implicit TLS, STARTTLS is mandatory.
    requireTLS: !secure && Boolean(env.SMTP_USER),
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS ?? "" } } : {})
  };
  return nodemailer.createTransport(options);
};

let transporter: ReturnType<typeof createTransport> | undefined;

/** Safe description for startup logs (no credentials). */
export const describeMailer = () =>
  isEmailEnabled()
    ? isEmailLogMode()
      ? { mode: "log" as const }
      : { mode: "smtp" as const, host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE ?? env.SMTP_PORT === 465, auth: Boolean(env.SMTP_USER) }
    : { mode: "disabled" as const };

export const sendMail = async (message: MailMessage): Promise<MailResult> => {
  if (!isEmailEnabled()) {
    throw new Error("E-mail delivery is not configured (SMTP_HOST / SMTP_FROM)");
  }
  const to = message.to.trim();
  if (!isDeliverableAddress(to)) {
    throw new PermanentMailError("Recipient address is not deliverable", "EADDRESS");
  }
  const subject = toSubjectLine(message.subject);

  if (isEmailLogMode()) {
    logger.info({ mail: { to, subject, text: message.text } }, "E-mail rendered (SMTP_HOST=log, not sent)");
    logger.debug({ mail: { html: message.html } }, "E-mail HTML (SMTP_HOST=log)");
    return { mode: "log", messageId: null };
  }

  transporter ??= createTransport();
  const info = await transporter.sendMail({ from: env.SMTP_FROM, to, subject, text: message.text, html: message.html });
  logger.debug({ to: maskAddress(to), messageId: info.messageId }, "E-mail sent");
  return { mode: "smtp", messageId: typeof info.messageId === "string" ? info.messageId : null };
};

export const closeMailer = () => {
  transporter?.close();
  transporter = undefined;
};
