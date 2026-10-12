import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["**/src/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "**/*.int.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["**/*.int.test.ts"],
          globalSetup: "test/integration/global-setup.ts",
          fileParallelism: false,
          testTimeout: 30000,
        },
      },
    ],
  },
});
