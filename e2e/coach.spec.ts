// Spec §11 "chat → approval card → applied". Runs after settings.spec.ts with LLM_MODE=mock, signed
// in as Ada through the shared storage state (no new sign-ins: the sign-in action is rate-limited).
import { expect, type Page, test } from "@playwright/test";
import { ensureMockProvider } from "./helpers";

test.describe.configure({ mode: "serial" });
test.beforeEach(async ({ page }) => {
  await ensureMockProvider(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Coach", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Coach", exact: true })).toBeVisible();
});
const send = async (page: Page, text: string) => {
  await page.getByLabel("Message").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
};

test("chat → approval card → approved memory shows on Profile", async ({ page }) => {
  await send(page, "Please remember that I prefer remote work.");
  const card = page.getByTestId("proposal-card").last();
  await expect(card.getByText("Remember this?")).toBeVisible();
  await expect(card.getByText("I prefer remote work")).toBeVisible();
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(card.getByText("Approved")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("proposal-card").last().getByText("Approved")).toBeVisible();
  await expect(page.getByRole("separator").first()).toContainText("Session ·");
  await page.goto("/profile");
  await expect(page.getByText("I prefer remote work")).toBeVisible();
});
test("lookups render as tool cards", async ({ page }) => {
  await send(page, "Look up registered nurse");
  await expect(
    page.getByText(/Looked up: Registered Nurses? \(O\*NET 29-1141\.00\)/),
  ).toBeVisible();
});
test("crisis messages get the safety response (Review Focus 1)", async ({ page }) => {
  const helplines = page.getByRole("link", { name: "Find a Helpline" });
  const previousCount = await helplines.count();
  await send(page, "I can't go on anymore");
  await expect(helplines).toHaveCount(previousCount + 1);
  await expect(helplines.last()).toHaveAttribute("href", "https://findahelpline.com");
});

test("latest reply remains above the mobile composer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  const response = page.waitForResponse((reply) => reply.url().endsWith("/api/chat"));
  await send(page, "Help me think about a small next step.");
  await response;
  await expect(page.getByRole("button", { name: "Stop reply" })).toBeHidden();
  const jump = page.getByRole("button", { name: "Jump to latest" });
  if (await jump.isVisible()) await jump.click();
  await expect
    .poll(async () => {
      const message = await page.locator(".chat-message").last().boundingBox();
      const composer = await page.locator(".chat-composer").boundingBox();
      return (message?.y ?? 0) + (message?.height ?? 0) <= (composer?.y ?? 0);
    })
    .toBe(true);
});
