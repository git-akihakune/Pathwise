import { expect, test } from "@playwright/test";

// The workflows project uses ADA_STATE from domain-setup.
test("Today shows the week, check-in schedule and coach note", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /^Welcome, / })).toBeVisible();
  for (const name of ["This week", "Weekly check-in", "From your coach"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  await expect(page.getByText(/^Next check-in: \w+ at \d{2}:\d{2}\.$/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Change schedule" })).toHaveAttribute(
    "href",
    "/settings",
  );
});

test("Today action checkboxes save and undo completion", async ({ page }) => {
  await page.goto("/plan");
  if (await page.getByRole("button", { name: "Create plan", exact: true }).isVisible()) {
    await page.getByLabel("North star").fill("Build health data skills");
    await page.getByRole("button", { name: "Create plan", exact: true }).click();
  }
  await page.getByLabel("New action").fill("Book a Today coaching call");
  await page.getByRole("button", { name: "Add action", exact: true }).click();
  await expect(page.getByText("Book a Today coaching call", { exact: true })).toBeVisible();
  await page.goto("/");
  const action = page.getByRole("checkbox", { name: "Book a Today coaching call", exact: true });
  await expect(action).not.toBeChecked();
  await action.check();
  await expect(action).toBeChecked();
  await expect(action).toBeEnabled();
  await page.reload();
  await expect(action).toBeChecked();
  await action.uncheck();
  await expect(action).toBeEnabled();
  await page.reload();
  await expect(action).not.toBeChecked();
});
