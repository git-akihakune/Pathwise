import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
  },
  // Playwright orders files alphabetically; admin.spec.ts needs the admin that auth.spec.ts creates.
  projects: [
    { name: "auth", testMatch: "auth.spec.ts", use: { ...devices["Desktop Chrome"] } },
    {
      name: "admin",
      testMatch: "admin.spec.ts",
      dependencies: ["auth"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
