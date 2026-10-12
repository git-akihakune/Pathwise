import { expect, type Page, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });
let inviteUrl = "";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /^Welcome, / })).toBeVisible();
}

test("admin invites a user", async ({ page }) => {
  await signIn(page, "ada@example.com", "a-very-long-password");
  await page.getByRole("link", { name: "Admin" }).click();
  await page.getByLabel("Invite email").fill("bob@example.com");
  await page.getByRole("button", { name: "Create invite" }).click();
  inviteUrl = await page.getByTestId("invite-link").inputValue();
  expect(inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
});
test("invited user signs up via the link", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto(inviteUrl);
  await expect(page.getByLabel("Email")).toHaveValue("bob@example.com");
  await page.getByLabel("Name").fill("Bob");
  await page.getByLabel("Password").fill("bobs-long-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Bob" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
});
test("a used invite link explains itself", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto(inviteUrl);
  await expect(page.getByText("This invitation has already been used.")).toBeVisible();
});
test("a non-admin cannot open the admin page", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, "bob@example.com", "bobs-long-password");
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/$/);
});
