import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { ADA, ensureMockProvider } from "./helpers";

// The workflows project signs in once through ADA_STATE (sign-in is rate-limited).
test.describe.configure({ mode: "serial" });

test("the check-in schedule can be changed", async ({ page }) => {
  await page.goto("/settings");
  await expect(
    page.getByText("Email isn't set up on this instance, so check-ins appear in the app only."),
  ).toBeVisible();
  await page.getByLabel("Day").selectOption("3");
  await page.getByLabel("Time", { exact: true }).fill("07:30"); // Plan 2's "Timezone" also matches "Time"
  await page.getByRole("button", { name: "Save check-in schedule" }).click();
  await expect(page.getByText("Check-in schedule saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Day")).toHaveValue("3");
  await expect(page.getByLabel("Time", { exact: true })).toHaveValue("07:30");
});

for (const staleCookie of [false, true]) {
  test(`the Start check-in link survives sign-in with ${staleCookie ? "a stale cookie" : "no cookie"}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    if (staleCookie) {
      await context.addCookies([
        {
          name: "better-auth.session_token",
          value: "revoked-session.invalid-signature",
          url: "http://localhost:3100",
          httpOnly: true,
        },
      ]);
    }
    const page = await context.newPage();
    await page.goto("/checkin");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fcheckin$/);
    await page.getByLabel("Email").fill(ADA.email);
    await page.getByLabel("Password").fill(ADA.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/checkin$/);
    await expect(page.getByRole("heading", { name: "Weekly check-in" })).toBeVisible();
    await expect(page.getByText("No check-in is open right now.")).toBeVisible();
    await expect(page.getByText(/^Your next check-in is \w+ at \d{2}:\d{2}\.$/)).toBeVisible();
    await context.close();
  });
}

test("weekly check-in flow (spec §11)", async ({ page }) => {
  await ensureMockProvider(page);
  await page.goto("/plan");
  if (await page.getByRole("button", { name: "Create plan", exact: true }).isVisible()) {
    await page.getByLabel("North star").fill("Build health data skills");
    await page.getByRole("button", { name: "Create plan", exact: true }).click();
  }
  await page.getByLabel("New action").fill("Finish the check-in course");
  await page.getByRole("button", { name: "Add action", exact: true }).click();
  await expect(page.getByText("Finish the check-in course", { exact: true })).toBeVisible();
  execSync(
    "docker compose --env-file /dev/null exec -T worker pathwise checkin start ada@example.com",
    { stdio: "inherit" },
  );
  await page.goto("/");
  await expect(page.getByText("Your weekly check-in is ready.")).toBeVisible();
  await page.getByRole("link", { name: "Start check-in" }).click();
  await expect(page.getByRole("heading", { name: "Wins" })).toBeVisible();
  await expect(page.getByText("Let's start with the good stuff.", { exact: false })).toBeVisible();
  await page.getByLabel("Message").fill("I finished the course. That's all.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("heading", { name: "This week's actions" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Finish the check-in course", { exact: true })).toBeVisible();
  await page.getByLabel("Message").fill("Mark this week's actions done.");
  await page.getByRole("button", { name: "Send" }).click();
  const proposal = page.getByTestId("proposal-card").filter({ hasText: "Update your actions?" });
  await expect(proposal).toBeVisible();
  await proposal.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(proposal.getByText("Approved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Move on" }).click();
  await expect(page.getByRole("heading", { name: "Blockers" })).toBeVisible();
  await page.getByRole("button", { name: "Move on" }).click();
  await expect(page.getByRole("heading", { name: "Energy", exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "2", exact: true }).check();
  await page.getByLabel("Anything to add? (optional)").fill("Tired");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Next week", exact: true })).toBeVisible();
  await expect(page.getByText("two actions at most", { exact: false })).toBeVisible();
  await page.getByLabel("Message").fill("Keep it light. That's all.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("heading", { name: "Check-in complete" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByText("Steady week: one action done, energy low, next week kept light."),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to Today" }).click();
  await expect(page.getByText("Check-in done for this week. Nice work.")).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Finish the check-in course", exact: true }),
  ).toBeChecked();
});
