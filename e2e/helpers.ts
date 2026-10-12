import { expect, type Page } from "@playwright/test";

/** Where domain.setup.ts saves the admin's signed-in browser state. */
export const ADA_STATE = "playwright/.auth/ada.json";
export const ADA = { email: "ada@example.com", password: "a-very-long-password" };

/** Signs in through the form and waits for the Today heading. Defaults to the admin from auth.spec.ts. */
export async function signIn(page: Page, email = ADA.email, password = ADA.password) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /^Welcome, / })).toBeVisible();
}
