import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          maxWorkers: 1,
          include: ["**/src/**/*.test.ts", "scripts/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "**/*.int.test.ts", "**/.next/**"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["**/*.int.test.ts"],
          exclude: [...configDefaults.exclude, "**/.next/**"],
          globalSetup: "test/integration/global-setup.ts",
          fileParallelism: false,
          testTimeout: 30000,
        },
      },
    ],
  },
});
