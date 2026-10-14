// Runs in the "domain" project: signed in via the shared storageState from domain.setup.ts.
import { expect, test } from "@playwright/test";

test("write, edit, and delete a story", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Stories", exact: true }).click();
  await expect(page.getByText("No stories yet.")).toBeVisible();
  await page.getByRole("link", { name: "Add story" }).click();
  await page.getByLabel("Title").fill("Cut report time by 80%");
  await page.getByLabel("Situation").fill("The weekly report took two days.");
  await page.getByLabel("Task", { exact: true }).fill("Make it faster.");
  await page.getByLabel("Action", { exact: true }).fill("Automated it with SQL.");
  await page.getByLabel("Result").fill("It now takes three hours.");
  await page.getByLabel("Metrics").fill("80% faster");
  await page.getByLabel("Skills (comma-separated)").fill("SQL, Automation");
  await page.getByRole("button", { name: "Save story" }).click();
  await expect(page).toHaveURL(/\/stories$/);
  const card = page.getByRole("article").filter({ hasText: "Cut report time by 80%" });
  await expect(card).toContainText("Automation");
  await expect(card).toContainText("80% faster");
  await card.getByRole("link", { name: "Edit" }).click();
  await page.getByLabel("Title").fill("Cut weekly report time by 80%");
  await page.getByRole("button", { name: "Save story" }).click();
  const edited = page.getByRole("article").filter({ hasText: "Cut weekly report time by 80%" });
  await edited.getByRole("button", { name: "Delete" }).click();
  await edited.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page.getByText("No stories yet.")).toBeVisible();
});
