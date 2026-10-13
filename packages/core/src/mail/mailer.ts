import nodemailer from "nodemailer";
import type { AppConfig } from "../config";
import { ConfigError } from "../errors";

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  ics?: { method: "REQUEST" | "CANCEL"; content: string };
}

export interface Mailer {
  enabled: boolean;
  /** Rejects with ConfigError when SMTP is not configured. */
  send(msg: MailMessage): Promise<void>;
}

export function createMailer(
  config: Pick<AppConfig, "smtp">,
  opts: { transport?: { sendMail(o: object): Promise<unknown> } } = {},
): Mailer {
  const smtp = config.smtp;
  if (!smtp) {
    return {
      enabled: false,
      async send() {
        throw new ConfigError("Email is not configured on this instance (SMTP_HOST is unset).");
      },
    };
  }
  const transport =
    opts.transport ??
    nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass ?? "" } : undefined,
    });
  return {
    enabled: true,
    async send(msg) {
      await transport.sendMail({
        from: smtp.from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        ...(msg.ics && {
          icalEvent: { method: msg.ics.method, filename: "checkin.ics", content: msg.ics.content },
        }),
      });
    },
  };
}

let memo: { key: string; mailer: Mailer } | undefined;

/** One mailer (and SMTP connection pool config) per process. */
export function mailerFor(config: Pick<AppConfig, "smtp">): Mailer {
  const key = JSON.stringify(config.smtp);
  if (!memo || memo.key !== key) memo = { key, mailer: createMailer(config) };
  return memo.mailer;
}
