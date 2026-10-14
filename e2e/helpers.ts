import { expect, type Page } from "@playwright/test";

/** Where domain.setup.ts saves the admin's signed-in browser state. */
export const ADA_STATE = "playwright/.auth/ada.json";
export const ADA = { email: "ada@example.com", password: "a-very-long-password" };

/** Signs in through the form and waits for the Today heading. Defaults to the admin from auth.spec.ts. */
export async function signIn(page: Page, email = ADA.email, password = ADA.password) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /^Welcome, / })).toBeVisible();
}

export const CONNECT = "Connect an AI provider to use the coach";

/**
 * Makes sure the signed-in user has an active provider (mock mode simulates its replies). Does
 * nothing when Today shows no setup prompt; otherwise adds and activates "Mock OpenAI".
 */
export async function ensureMockProvider(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /^Welcome, / })).toBeVisible();
  if ((await page.getByText(CONNECT).count()) === 0) return;
  await page.goto("/settings");
  await page.getByLabel("Provider", { exact: true }).click();
  await page.getByRole("option", { name: "OpenAI", exact: true }).click();
  await page.getByLabel("Label", { exact: true }).fill("Mock OpenAI");
  await page.getByLabel("API key", { exact: true }).fill("sk-test-0000000000009999");
  await page.getByLabel("Main model").fill("gpt-main");
  await page.getByLabel("Fast model").fill("gpt-fast");
  await page.getByRole("button", { name: "Save and test" }).click();
  await expect(page.getByText("Full support. All coach features are available.")).toBeVisible();
  const row = page.getByRole("row", { name: /Mock OpenAI/ });
  await row.getByRole("button", { name: "Activate" }).click();
  await expect(row.getByText("Active", { exact: true })).toBeVisible();
}
