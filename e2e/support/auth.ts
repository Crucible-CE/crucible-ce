import { expect, type Page } from "@playwright/test";
import { settle, storageStatePath, type UserKey } from "./fixtures";
import type { User } from "./helpers";

/** Sign in through the real login form and land on the dashboard. */
export async function uiLogin(page: Page, user: User): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await settle(page);
}

/** Sign in and save the context's cookies for later specs (`as(user)`). */
export async function loginAndSave(page: Page, key: UserKey, user: User): Promise<void> {
  await uiLogin(page, user);
  await page.context().storageState({ path: storageStatePath(key) });
}
