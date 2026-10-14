import { expect, test } from "@playwright/test";

test("workspace theme survives navigation and stays accessible on mobile", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.goto("/");
  const theme = page.getByRole("combobox", { name: "Theme", exact: true });
  await theme.click();
  await page.getByRole("option", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.screenshot({
    path: test.info().outputPath("dark-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  for (const route of ["/profile", "/plan", "/stories", "/settings", "/coach", "/admin"]) {
    await page.goto(route);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(theme).toContainText("Dark");
    await expect(page.locator(".workspace-page")).toHaveCSS("animation-name", "workspace-enter");
  }
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/plan");
  await expect(theme).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("dark-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation", exact: true });
  await expect(drawer).toHaveCSS("animation-name", "drawer-enter");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".workspace-page")).toHaveCSS("animation-name", "none");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(drawer).toHaveCSS("animation-name", "none");
  await page.keyboard.press("Escape");
  await theme.click();
  await page.getByRole("option", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

// Uses the shared admin session. These checks protect the responsive shell and keyboard flows.
test("navigation identifies the current screen and nested story editor", async ({ page }) => {
  await page.goto("/profile");
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation.getByRole("link", { name: "Profile", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page).toHaveTitle("Profile | Pathwise");
  await page.goto("/stories/new");
  await expect(navigation.getByRole("link", { name: "Stories", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("mobile navigation supports keyboard dismissal and route changes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const menu = page.getByRole("button", { name: "Open navigation" });
  await menu.click();
  const dialog = page.getByRole("dialog", { name: "Navigation" });
  await expect(dialog).toBeVisible();
  await expect.poll(async () => Math.round((await dialog.boundingBox())?.x ?? -1)).toBe(0);
  const close = dialog.getByRole("button", { name: "Close", exact: true });
  const closeBounds = await close.boundingBox();
  expect(closeBounds?.y).toBeLessThan(64);
  expect(closeBounds?.x).toBeGreaterThan(240);
  await close.click();
  await expect(dialog).toBeHidden();
  await expect(menu).toBeFocused();
  await menu.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(menu).toBeFocused();
  await menu.click();
  await dialog.getByRole("link", { name: "Profile", exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(dialog).toBeHidden();
});

test("key screens fit a narrow viewport with visible primary actions", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  for (const route of ["/", "/profile", "/stories", "/plan", "/settings", "/coach", "/admin"]) {
    await page.goto(route);
    await expect(page.locator("main h1")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
});

test("skip link moves keyboard focus to the main content", async ({ page }) => {
  await page.goto("/profile");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
});

test("password visibility is explicit and errors preserve the email", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  const password = page.getByLabel("Password", { exact: true });
  await page.getByLabel("Email", { exact: true }).fill("missing@example.com");
  await password.fill("incorrect-password");
  await page.getByRole("button", { name: "Show password", exact: true }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password", exact: true }).click();
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Email or password is incorrect." }),
  ).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("missing@example.com");
  await context.close();
});

test("form validation is inline and focuses the missing field", async ({ page }) => {
  await page.goto("/profile");
  await page.getByRole("button", { name: "Add experience", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Enter job title." })).toBeVisible();
  await expect(page.getByLabel("Job title")).toBeFocused();
  await expect(page.getByLabel("Job title")).toHaveAttribute("aria-invalid", "true");
});

test("failed saves preserve edits and navigation offers a discard choice", async ({ page }) => {
  await page.goto("/profile");
  await page.getByRole("button", { name: "Add experience", exact: true }).click();
  await page.getByLabel("Job title").fill("Unsaved role");
  await page.getByLabel("Start", { exact: true }).fill("March 2021");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Use YYYY, YYYY-MM or YYYY-MM-DD." }),
  ).toBeVisible();
  await expect(page.getByLabel("Job title")).toHaveValue("Unsaved role");
  await page.getByRole("link", { name: "Stories", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Leave your unsaved changes?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByLabel("Job title")).toHaveValue("Unsaved role");
  await page.getByRole("link", { name: "Stories", exact: true }).click();
  await dialog.getByRole("button", { name: "Discard changes" }).click();
  await expect(page).toHaveURL(/\/stories$/);
});

test("provider popup aligns with the field and returns keyboard focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");
  const trigger = page.getByLabel("Provider", { exact: true });
  await trigger.click();
  const popup = page.locator('[data-slot="select-content"]');
  await expect(popup).toBeVisible();
  const field = await trigger.boundingBox();
  const list = await popup.boundingBox();
  expect(field).not.toBeNull();
  expect(list).not.toBeNull();
  expect(Math.abs((field?.width ?? 0) - (list?.width ?? 0))).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  await expect(popup).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("discarding edits through mobile navigation closes both dialogs", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/profile");
  await page.getByRole("button", { name: "Add experience", exact: true }).click();
  await page.getByLabel("Job title").fill("Mobile draft");
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation", exact: true });
  await expect.poll(async () => Math.round((await drawer.boundingBox())?.x ?? -1)).toBe(0);
  const bounds = await drawer.boundingBox();
  expect(bounds?.x).toBe(0);
  expect(bounds?.width).toBeLessThanOrEqual(320);
  await drawer.getByRole("link", { name: "Stories", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Leave your unsaved changes?" })
    .getByRole("button", { name: "Discard changes" })
    .click();
  await expect(page).toHaveURL(/\/stories$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Stories", exact: true })).toBeVisible();
});

test("skill search supports keyboard selection and immediate clearing", async ({ page }) => {
  await page.goto("/profile");
  await page.getByRole("button", { name: "Add skill", exact: true }).click();
  const input = page.getByLabel("Skill", { exact: true });
  await input.fill("Programm");
  const listbox = page.getByRole("listbox", { name: "Matching skills" });
  const first = listbox.getByRole("option").first();
  await expect(first).toBeVisible();
  const name = await first.getAttribute("aria-label");
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(input).toHaveValue(name ?? "");
  await page.getByRole("button", { name: "Clear skill search" }).click();
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await expect(listbox).toBeHidden();
});

test("a disconnected save keeps the form available for recovery", async ({ page, context }) => {
  await page.goto("/profile");
  await page.getByRole("button", { name: "Add experience", exact: true }).click();
  await page.getByLabel("Job title").fill("Offline draft role");
  await context.setOffline(true);
  try {
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Couldn't confirm this action." }),
    ).toBeVisible();
    await expect(page.getByLabel("Job title")).toHaveValue("Offline draft role");
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  } finally {
    await context.setOffline(false);
  }
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const saved = page.getByRole("listitem").filter({ hasText: "Offline draft role" });
  await expect(saved).toBeVisible();
  await saved.getByRole("button", { name: "Delete", exact: true }).click();
  await saved.getByRole("button", { name: "Yes, delete", exact: true }).click();
  await expect(saved).toHaveCount(0);
});

test("a prefilled coaching draft warns before link navigation", async ({ page }) => {
  await page.goto("/coach?prompt=Review%20my%20next%20step");
  await expect(page.getByLabel("Message")).toBeVisible();
  await expect(page.getByLabel("Message")).toHaveValue("Review my next step");
  await page.getByRole("link", { name: "Profile", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Leave your unsaved changes?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByLabel("Message")).toHaveValue("Review my next step");
});

test("structural safety-resource edits are protected before saving", async ({ page }) => {
  await page.goto("/admin");
  const panel = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole("heading", { name: "Safety resources", exact: true }) });
  await panel.getByRole("button", { name: "Remove", exact: true }).first().click();
  await page.getByRole("link", { name: "Profile", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Leave your unsaved changes?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Discard changes" }).click();
  await expect(page).toHaveURL(/\/profile$/);
});
