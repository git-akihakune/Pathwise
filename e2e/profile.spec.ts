// Runs after auth.spec.ts (project dependency), signed in as the admin it created (domain.setup.ts).
import { expect, type Page, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function openProfile(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "Profile", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Profile", level: 1 })).toBeVisible();
}

test("add, edit, and delete an experience", async ({ page }) => {
  await openProfile(page);
  await page.getByRole("button", { name: "Add experience" }).click();
  await page.getByLabel("Job title").fill("Data Analyst");
  await page.getByLabel("Organization").fill("Acme");
  await page.getByLabel("Start", { exact: true }).fill("2021-03");
  await page.getByRole("button", { name: "Save" }).click();
  const item = page.getByRole("listitem").filter({ hasText: "Data Analyst" });
  await expect(item).toContainText("Acme");
  await expect(item).toContainText("2021-03 – present");
  await expect(item).toContainText("Added by you");
  await item.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Job title").fill("Senior Data Analyst");
  await page.getByRole("button", { name: "Save" }).click();
  const edited = page.getByRole("listitem").filter({ hasText: "Senior Data Analyst" });
  await edited.getByRole("button", { name: "Delete" }).click();
  await edited.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page.getByText("Senior Data Analyst")).toHaveCount(0);
});

test("invalid dates are explained", async ({ page }) => {
  await openProfile(page);
  await page.getByRole("button", { name: "Add experience" }).click();
  await page.getByLabel("Job title").fill("Analyst");
  await page.getByLabel("Start", { exact: true }).fill("March 2021");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Use YYYY, YYYY-MM or YYYY-MM-DD.")).toBeVisible();
});

test("add a skill linked to the taxonomy", async ({ page }) => {
  await openProfile(page);
  await page.getByRole("button", { name: "Add skill" }).click();
  await page.getByLabel("Skill", { exact: true }).fill("Programm");
  await page.getByRole("option", { name: "Programming", exact: true }).click();
  await page.getByLabel("Level").selectOption("strong");
  await page.getByRole("button", { name: "Save" }).click();
  const item = page.getByRole("listitem").filter({ hasText: "Programming" });
  await expect(item).toContainText("Strong");
  await expect(item).toContainText("Linked to O*NET");
});

test("remember a value, then delete it", async ({ page }) => {
  await openProfile(page);
  await page.getByRole("button", { name: "Add something about you" }).click();
  await page.getByLabel("Category").selectOption("value");
  await page.getByLabel("What should I remember?").fill("Autonomy over my schedule");
  await page.getByRole("button", { name: "Save" }).click();
  const values = page.getByRole("region", { name: "Values" });
  const item = values.getByRole("listitem").filter({ hasText: "Autonomy over my schedule" });
  await expect(item).toContainText("Added by you");
  await item.getByRole("button", { name: "Delete" }).click();
  await item.getByRole("button", { name: "Yes, delete" }).click();
  await expect(values.getByText("Nothing yet.")).toBeVisible();
});
