import { expect, it } from "vitest";
import {
  encouragement,
  renderCalendarEmail,
  renderCheckinEmail,
  renderInviteEmail,
  renderNudgeEmail,
  renderPasswordResetEmail,
  renderVerificationEmail,
} from ".";

const url = "https://coach.example.com/checkin";
it("weekly check-in email lists the week and links to /checkin without a login token", async () => {
  const m = await renderCheckinEmail({
    name: "Ada",
    weekOf: "2026-10-12",
    done: ["Book a call"],
    remaining: ["Update CV"],
    url,
  });
  expect(m.subject).toBe("Your weekly check-in is ready");
  expect(m.html).toContain(`href="${url}"`);
  expect(m.text).toContain("Book a call");
  expect(m.text).toContain("Update CV");
  expect(m.text).toContain("You finished 1 of 2 actions this week. Small steps add up.");
  expect(m.html).not.toMatch(/token=/);
});
it("escapes user-provided text in html", async () => {
  const m = await renderCheckinEmail({
    name: "<script>alert(1)</script>",
    weekOf: "2026-10-12",
    done: ['<img src=x onerror="y">'],
    remaining: [],
    url,
  });
  expect(m.html).not.toContain("<script>");
  expect(m.html).not.toContain("<img src=x");
});
it.each([
  [0, 0, "A check-in is a good moment to plan the week ahead."],
  [0, 3, "No pressure. A short check-in is the easiest way to get going again."],
  [3, 3, "You finished everything you planned. Great week."],
])("encouragement(%i, %i) never guilt-trips", (done, total, line) => {
  expect(encouragement(done, total)).toBe(line);
});
it("nudge and invite emails", async () => {
  expect((await renderNudgeEmail({ name: "Ada", url })).subject).toBe(
    "Your check-in is still open",
  );
  const invite = await renderInviteEmail({
    inviterName: "Ada",
    url: "https://coach.example.com/invite/abc",
  });
  expect(invite.subject).toBe("You're invited to Pathwise");
  expect(invite.text).toContain("expires in 7 days");
  expect(invite.text).not.toContain("turn them off in Settings");
});
it("auth and calendar emails", async () => {
  const reset = await renderPasswordResetEmail({ name: "Ada", url });
  expect(reset.subject).toBe("Reset your Pathwise password");
  expect(reset.text).toContain("expires in 1 hour");
  expect((await renderVerificationEmail({ name: "Ada", url })).subject).toBe(
    "Verify your email for Pathwise",
  );
  const req = await renderCalendarEmail({
    name: "Ada",
    method: "REQUEST",
    day: 0,
    time: "18:00",
    timezone: "UTC",
  });
  expect(req.subject).toBe("Your weekly Pathwise check-in");
  expect(req.text).toContain("Your check-ins are set for Sundays at 18:00 (UTC).");
  const cancel = await renderCalendarEmail({
    name: "Ada",
    method: "CANCEL",
    day: 0,
    time: "18:00",
    timezone: "UTC",
  });
  expect(cancel.subject).toBe("Weekly Pathwise check-in cancelled");
});
