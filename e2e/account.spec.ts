import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { ADA, signIn } from "./helpers";

const carol = { name: "Carol", email: "carol@example.com", password: "carols-long-password" };

test("an invited user downloads their own data", async ({ page, browser }) => {
  await page.goto("/admin");
  await page.getByLabel("Invite email").fill(carol.email);
  await page.getByRole("button", { name: "Create invite" }).click();
  const inviteUrl = await page.getByTestId("invite-link").inputValue();
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const carolPage = await context.newPage();
    await carolPage.goto(inviteUrl);
    await carolPage.getByLabel("Name").fill(carol.name);
    await carolPage.getByLabel("Password").fill(carol.password);
    await carolPage.getByRole("button", { name: "Create account" }).click();
    await expect(carolPage.getByRole("heading", { name: `Welcome, ${carol.name}` })).toBeVisible();
    await carolPage.goto("/settings");
    const [download] = await Promise.all([
      carolPage.waitForEvent("download"),
      carolPage.getByRole("link", { name: "Download my data" }).click(),
    ]);
    // Chromium downloads emit a download event without a page response event.
    const response = await carolPage.request.get("/api/account/export");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/zip");
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(download.suggestedFilename()).toMatch(/^pathwise-export-\d{4}-\d{2}-\d{2}\.zip$/);
    const downloadPath = await download.path();
    assert(downloadPath, "The download must be saved locally.");
    const zip = unzipSync(readFileSync(downloadPath));
    const bundle = zip["pathwise-export.json"];
    assert(bundle, "The ZIP must contain pathwise-export.json.");
    const data = JSON.parse(strFromU8(bundle));
    expect(data.tables.user).toEqual([expect.objectContaining({ email: carol.email })]);
    expect(JSON.stringify(data)).not.toMatch(/encryptedKey|ada@example.com|"password"|"token"/);
    expect(data.tables).not.toHaveProperty("account");
    expect(data.tables).not.toHaveProperty("session");
  } finally {
    await context.close();
  }
});

test("anonymous visitors cannot download account data", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const response = await context.request.get("/api/account/export");
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  } finally {
    await context.close();
  }
});

test("the only admin cannot delete their account", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Delete account", exact: true }).click();
  await page.getByLabel("Type your email to confirm").fill(ADA.email);
  await page.getByRole("button", { name: "Delete my account" }).click();
  await expect(page.getByText("You're the only admin. Promote another admin first.")).toBeVisible();
});

test("a user deletes their account and can no longer sign in", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    await signIn(page, carol.email, carol.password);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Delete account", exact: true }).click();
    const confirm = page.getByRole("button", { name: "Delete my account" });
    await expect(confirm).toBeDisabled();
    await page.getByLabel("Type your email to confirm").fill("someone@else.io");
    await expect(confirm).toBeDisabled();
    await page.getByLabel("Type your email to confirm").fill(` ${carol.email.toUpperCase()} `);
    await confirm.click();
    await expect(page).toHaveURL(/\/sign-in\?deleted=1$/);
    await expect(page.getByText("Your account has been deleted.")).toBeVisible();
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(carol.email);
    await page.getByLabel("Password").fill(carol.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
  } finally {
    await context.close();
  }
});
