import { type Browser, expect, type Page, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });
const CONNECT = "Connect an AI provider to use the coach";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /^Welcome, / })).toBeVisible();
}
const bob = async (browser: Browser) => {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, "bob@example.com", "bobs-long-password");
  return page;
};

test("a member without a provider sees the setup prompt", async ({ browser }) => {
  await expect((await bob(browser)).getByText(CONNECT)).toBeVisible();
});

test("the admin sets the instance provider and sees usage", async ({ page }) => {
  await signIn(page, "ada@example.com", "a-very-long-password");
  await page.goto("/admin");
  const section = page.getByRole("region", { name: "Instance provider" });
  await section.getByLabel("Provider", { exact: true }).click();
  await page.getByRole("option", { name: "Anthropic", exact: true }).click();
  await section.getByLabel("Label", { exact: true }).fill("Team Anthropic");
  await section.getByLabel("API key").fill("sk-ant-test-9999");
  await section.getByLabel("Main model").fill("claude-sonnet-5-5");
  await section.getByLabel("Fast model").fill("claude-haiku-5-5");
  await section.getByRole("button", { name: "Save and test" }).click();
  await expect(section.getByText("Full support. All coach features are available.")).toBeVisible();
  await expect(section.getByText("••••9999")).toBeVisible();
  await page.reload();
  const usage = page.getByRole("table", { name: "Usage (last 30 days)" });
  await expect(usage.getByRole("cell", { name: "ada@example.com" }).first()).toBeVisible();
});

test("members fall back to the instance provider", async ({ browser }) => {
  await expect((await bob(browser)).getByText(CONNECT)).toHaveCount(0);
});
