// Runs after admin.spec.ts (project dependency) with LLM_MODE=mock, signed in as Ada (domain.setup.ts).
import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });
const KEY = "sk-test-0000000000001234";
const CONNECT = "Connect an AI provider to use the coach";

test("a user without a provider is prompted to connect one", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(CONNECT)).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(
    page.getByText("Mock mode: AI replies are simulated (LLM_MODE=mock)."),
  ).toBeVisible();
});

test("without a provider the coach keeps its input: a plain message gets the setup hint, a crisis message gets help (R17)", async ({
  page,
}) => {
  await page.goto("/coach");
  await expect(page.getByText("The coach needs an AI provider before it can reply.")).toBeVisible();
  const input = page.getByLabel("Message");
  await expect(input).toBeEnabled();
  await input.fill("Help me plan my week");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByText("Connect an AI provider in Settings to use the coach."),
  ).toBeVisible();
  await input.fill("I can't go on anymore");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("link", { name: "Find a Helpline" })).toBeVisible();
});

test("add, test and activate an OpenAI provider (Review Focus 5)", async ({ page }) => {
  await page.goto("/");
  await page.goto("/settings");
  await page.getByLabel("Provider", { exact: true }).click();
  await page.getByRole("option", { name: "OpenAI", exact: true }).click();
  await page.getByLabel("Label", { exact: true }).fill("My OpenAI");
  await page.getByLabel("API key").fill(KEY);
  await page.getByLabel("Main model").fill("gpt-main");
  await page.getByLabel("Fast model").fill("gpt-fast");
  await page.getByRole("button", { name: "Save and test" }).click();
  await expect(page.getByText("Full support. All coach features are available.")).toBeVisible();
  await expect(page.getByText("Passed", { exact: true })).toHaveCount(4);
  const row = page.getByRole("row", { name: /My OpenAI/ });
  await expect(row.getByText("Full support", { exact: true })).toBeVisible();
  await expect(row.getByText("••••1234")).toBeVisible();
  await row.getByRole("button", { name: "Activate" }).click();
  await expect(row.getByText("Active", { exact: true })).toBeVisible();
  await expect(page.getByText(CONNECT)).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("API key")).toHaveValue("");
  expect(await page.content()).not.toContain(KEY);
});

test("coach settings persist", async ({ page }) => {
  await page.goto("/");
  await page.goto("/settings");
  await page.getByLabel("Blunt", { exact: true }).check();
  await page.getByLabel("Timezone").selectOption("Europe/Berlin");
  await page.getByRole("button", { name: "Save coach settings" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Blunt", { exact: true })).toBeChecked();
  await expect(page.getByLabel("Timezone")).toHaveValue("Europe/Berlin");
});
