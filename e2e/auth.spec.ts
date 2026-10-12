import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });
const admin = { name: "Ada Admin", email: "ada@example.com", password: "a-very-long-password" };

test("unauthenticated visitors are sent to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
});
test("first sign-up creates the admin and lands on Today", async ({ page }) => {
  await page.goto("/sign-up");
  await expect(page.getByRole("heading", { name: "Create the admin account" })).toBeVisible();
  await page.getByLabel("Name").fill(admin.name);
  await page.getByLabel("Email").fill(admin.email);
  await page.getByLabel("Password").fill(admin.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: `Welcome, ${admin.name}` })).toBeVisible();
  await expect(page.getByRole("link", { name: "Admin" })).toBeVisible();
});
test("sign-up is invitation-only afterwards", async ({ page }) => {
  await page.goto("/sign-up");
  await expect(page.getByText("Sign-up on this instance is by invitation.")).toBeVisible();
});
test("sign out and back in", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(admin.email);
  await page.getByLabel("Password").fill("wrong-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
  await page.getByLabel("Password").fill(admin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: `Welcome, ${admin.name}` })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});
test("origin mismatch is explained (Review Focus 2)", async ({ page }) => {
  await page.goto(process.env.E2E_ALT_ORIGIN_URL ?? "http://127.0.0.1:3100/sign-in");
  await expect(page.getByText(/configured for http:\/\/localhost:3100/)).toBeVisible();
  await expect(page.getByText(/APP_URL/)).toBeVisible();
});
