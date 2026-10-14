// Runs in the "domain" project: signed in via the shared storageState from domain.setup.ts.
import { expect, test } from "@playwright/test";

test("create a plan and edit it by hand", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Plan", exact: true }).click();
  await expect(page.getByText("You don't have a plan yet.")).toBeVisible();
  await expect(
    page.getByText("No career paths yet. Ask your coach to suggest some."),
  ).toBeVisible();

  await page.getByLabel("North star").fill("Move into data analysis within a year");
  await page.getByRole("button", { name: "Create plan" }).click();
  await expect(page.getByRole("heading", { name: "Milestones" })).toBeVisible();

  await page.getByLabel("New milestone").fill("Finish a SQL course");
  await page.getByLabel("Target date").fill("2027-03-31");
  await page.getByRole("button", { name: "Add milestone" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Finish a SQL course" })).toContainText(
    "31 Mar 2027",
  );

  await page.getByLabel("New action").fill("Complete 5 SQL exercises");
  await page.getByLabel("Milestone (optional)").selectOption({ label: "Finish a SQL course" });
  await page.getByRole("button", { name: "Add action" }).click();
  const thisWeek = page.getByRole("region", { name: "This week" });
  const done = thisWeek.getByRole("checkbox", { name: "Done: Complete 5 SQL exercises" });
  await done.check();
  await page.reload();
  await expect(done).toBeChecked();

  await page.getByRole("button", { name: "Edit north star" }).click();
  await page.getByLabel("North star").fill("Become a data analyst by next autumn");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Become a data analyst by next autumn")).toBeVisible();

  await page.getByLabel("Status of Finish a SQL course").selectOption("done");
  await expect(page.getByLabel("Status of Finish a SQL course")).toHaveValue("done");

  const action = thisWeek.getByRole("listitem").filter({ hasText: "Complete 5 SQL exercises" });
  await action.getByRole("button", { name: "Remove" }).click();
  await action.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page.getByText("Complete 5 SQL exercises")).toHaveCount(0);
});
