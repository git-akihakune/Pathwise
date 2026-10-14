import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test("theme selection persists and System follows the browser preference", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/sign-in");
  const theme = page.getByRole("combobox", { name: "Theme", exact: true });
  await expect(theme).toContainText("System");
  const field = await theme.boundingBox();
  await theme.click();
  const popup = page.getByRole("listbox");
  await expect(popup).toBeVisible();
  const list = await popup.boundingBox();
  expect(Math.abs((field?.width ?? 0) - (list?.width ?? 0))).toBeLessThanOrEqual(1);
  await page.getByRole("option", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(theme).toBeFocused();
  await page.reload();
  await expect(theme).toContainText("Dark");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await theme.click();
  await page.getByRole("option", { name: "System", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await theme.click();
  await page.getByRole("option", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
});

test("saved dark mode applies before hydration", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    javaScriptEnabled: true,
    colorScheme: "light",
    storageState: {
      cookies: [],
      origins: [
        {
          origin: baseURL ?? "http://localhost:3100",
          localStorage: [{ name: "pathwise-theme", value: "dark" }],
        },
      ],
    },
  });
  const page = await context.newPage();
  // Blocking application chunks leaves only the pre-paint theme script running.
  await page.route("**/_next/**/*.js*", (route) => route.abort());
  await page.goto(`${baseURL}/sign-in`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await context.close();
});

test("dark mode and keyboard theme selection work on mobile with reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/sign-in");
  await expect(page.locator("html")).toHaveClass(/dark/);
  const theme = page.getByRole("combobox", { name: "Theme", exact: true });
  await theme.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(theme).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const journey = page.locator(".journey-node").first();
  await expect(journey).toHaveCSS("animation-name", "none");
});

test("theme stays usable when browser storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Blocked", "SecurityError");
      },
    });
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/sign-in");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("combobox", { name: "Theme", exact: true }).click();
  await page.getByRole("option", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("theme choices synchronize between tabs and clearing returns to System", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/sign-in");
  const other = await context.newPage();
  await other.emulateMedia({ colorScheme: "light" });
  await other.goto("/sign-in");
  await page.getByRole("combobox", { name: "Theme", exact: true }).click();
  await page.getByRole("option", { name: "Dark", exact: true }).click();
  await expect(other.locator("html")).toHaveClass(/dark/);
  await expect(other.getByRole("combobox", { name: "Theme", exact: true })).toContainText("Dark");
  await page.evaluate(() => localStorage.removeItem("pathwise-theme"));
  await expect(other.getByRole("combobox", { name: "Theme", exact: true })).toContainText("System");
  await expect(other.locator("html")).not.toHaveClass(/dark/);
  await other.emulateMedia({ colorScheme: "dark" });
  await expect(other.locator("html")).toHaveClass(/dark/);
});

test("a failed preference write retains the current choice", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
  });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/sign-in");
  await page.getByRole("combobox", { name: "Theme", exact: true }).click();
  await page.getByRole("option", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveClass(/dark/);
});
