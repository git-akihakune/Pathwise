import { test as setup } from "@playwright/test";
import { ADA_STATE, signIn } from "./helpers";

setup("sign in as the admin", async ({ page }) => {
  await signIn(page);
  await page.context().storageState({ path: ADA_STATE });
});
