import { defineConfig, devices } from "@playwright/test";
import { ADA_STATE } from "./e2e/helpers";

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
    {
      name: "account",
      testMatch: "account.spec.ts",
      dependencies: ["auth", "domain-setup"],
      use: { ...devices["Desktop Chrome"], storageState: ADA_STATE },
    },
    {
      name: "settings",
      testMatch: "settings.spec.ts",
      dependencies: ["admin", "domain-setup"],
      use: { ...devices["Desktop Chrome"], storageState: ADA_STATE },
    },
    {
      name: "instance-provider",
      testMatch: "instance-provider.spec.ts",
      dependencies: ["settings"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "coach",
      testMatch: "coach.spec.ts",
      dependencies: ["settings"],
      use: { ...devices["Desktop Chrome"], storageState: ADA_STATE },
    },
    {
      name: "workflows",
      testMatch: /(onboarding|checkin|today)\.spec\.ts/,
      dependencies: ["coach"],
      use: { ...devices["Desktop Chrome"], storageState: ADA_STATE },
    },
    // The sign-in action allows 10 attempts per minute, so the domain specs share one sign-in.
    {
      name: "domain-setup",
      testMatch: "domain.setup.ts",
      dependencies: ["auth"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "domain",
      testMatch: /(profile|stories|plan)\.spec\.ts/,
      dependencies: ["domain-setup"],
      use: { ...devices["Desktop Chrome"], storageState: ADA_STATE },
    },
  ],
});
