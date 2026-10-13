import { expect, test } from "@playwright/test";

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
