import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

test("an invited user downloads their own data", async ({ page, browser }) => {
  const carol = { name: "Carol", email: "carol@example.com", password: "carols-long-password" };
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
    const [download, response] = await Promise.all([
      carolPage.waitForEvent("download"),
      carolPage.waitForResponse((response) => response.url().endsWith("/api/account/export")),
      carolPage.getByRole("link", { name: "Download my data" }).click(),
    ]);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/zip");
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(download.suggestedFilename()).toMatch(/^pathwise-export-\d{4}-\d{2}-\d{2}\.zip$/);
    const zip = unzipSync(readFileSync((await download.path())!));
    const data = JSON.parse(strFromU8(zip["pathwise-export.json"]!));
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
