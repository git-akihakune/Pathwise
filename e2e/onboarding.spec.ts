import { expect, test } from "@playwright/test";
import { makePdf } from "../test/fixtures/documents";
import { ensureMockProvider } from "./helpers";

// The workflows project signs in once through ADA_STATE (sign-in is rate-limited).
test.describe.configure({ mode: "serial" });
const CV =
  "Jane Doe. Staff Nurse at City Hospital since March 2018. BSc Nursing, University of Leeds.";

test("Today offers setup until onboarding is done", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /^Welcome, / })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Set up your coach" })).toBeVisible();
});

test("onboarding: upload, review, intake, confirm (spec §11)", async ({ page }) => {
  await ensureMockProvider(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Start", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Add your CV or LinkedIn profile" }),
  ).toBeVisible();
  await page
    .getByLabel("File")
    .setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: makePdf(CV) });
  await page.getByRole("button", { name: "Upload" }).click();
  // The worker reads the PDF in a forked child and extracts with the mock model.
  await expect(page.getByRole("heading", { name: "Check what we found" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByLabel("Title").first()).toHaveValue("Staff Nurse");
  await page.getByLabel("Title").first().fill("Senior Staff Nurse");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("heading", { name: "Get to know you" })).toBeVisible();
  await expect(page.getByText("Let's get to know each other.")).toBeVisible();
  await page.getByLabel("Message").fill("I value autonomy and want to work with data. That's all.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("heading", { name: "Here's what I heard" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Looks right" }).click();
  await expect(page).toHaveURL(/\/coach$/);
  await page.goto("/profile");
  await expect(page.getByText("Senior Staff Nurse")).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Set up your coach" })).toHaveCount(0);
});

test("an image disguised as a PDF is refused with a clear message (Review Focus 3)", async ({
  page,
}) => {
  const res = await page.request.post("/api/documents", {
    multipart: {
      kind: "cv",
      file: {
        name: "cv.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]),
      },
    },
  });
  expect(res.status()).toBe(415);
  expect((await res.json()).message).toBe(
    "Upload a PDF, a Word document (.docx), or a plain-text file.",
  );
});
