import nodemailer from "nodemailer";
import { expect, it } from "vitest";
import { createMailer } from "./mailer";

const smtp = {
  host: "smtp.example.com",
  port: 587,
  user: null,
  pass: null,
  from: "coach@example.com",
};
const msg = { to: "ada@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi" };

it("is disabled without SMTP", async () => {
  const m = createMailer({ smtp: null });
  expect(m.enabled).toBe(false);
  await expect(m.send(msg)).rejects.toThrow(/not configured/);
});
it("sends html, text and a calendar part", async () => {
  const stream = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const raw: string[] = [];
  const m = createMailer(
    { smtp },
    {
      transport: {
        sendMail: async (o: object) => {
          const info = await stream.sendMail(o);
          raw.push((info.message as Buffer).toString());
          return info;
        },
      },
    },
  );
  await m.send({
    ...msg,
    ics: { method: "REQUEST", content: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n" },
  });
  expect(raw[0]).toMatch(/^From: coach@example\.com/m);
  expect(raw[0]).toContain("Content-Type: text/calendar; charset=utf-8; method=REQUEST");
  expect(raw[0]).toContain("filename=checkin.ics");
});
