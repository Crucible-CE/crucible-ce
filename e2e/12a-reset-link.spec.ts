// 12a. Password reset without email: an admin copies a one-time reset link for
// a member; the member opens it in their own browser, sets a new password and
// signs in. Their existing session ends; the link works once.
import type { Page } from "@playwright/test";
import { expect, settle, test } from "./support/fixtures";
import { uiLogin } from "./support/auth";
import { BASE_URL, expectJson, go, need, toast, uniq, type User } from "./support/helpers";

/** Answer "confirm it's you" if the step-up dialog shows up, then wait for `done`. */
async function stepUpIfAsked(page: Page, done: import("@playwright/test").Locator, password: string): Promise<void> {
  const dlg = page.getByRole("dialog", { name: "Confirm it's you" });
  await expect(dlg.or(done).first()).toBeVisible();
  if (await dlg.isVisible()) {
    await dlg.locator("#reauth-password").fill(password);
    await dlg.getByRole("button", { name: "Confirm" }).click();
    await expect(dlg).toBeHidden();
  }
  await expect(done).toBeVisible();
}

async function setNewPassword(page: Page, link: string, password: string): Promise<void> {
  await go(page, link);
  await expect(page.getByRole("heading", { name: "New password" })).toBeVisible();
  await page.locator("#password").fill(password);
  await page.locator("#confirmPassword").fill(password);
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByRole("heading", { name: "Password reset" })).toBeVisible();
  await settle(page);
}

test("admin copies a reset link for a member; the member sets a new password and signs in", async ({ as, anon, guard }) => {
  const admin = need("admin");
  const { page, context } = await as("admin");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_URL });

  // A new member, signed in in their own browser.
  const member: User = { name: "Remy Reset", email: `${uniq("remy")}@e2e.test`, password: "E2e-Remy-Passw0rd!" };
  const invite = await expectJson<{ inviteUrl: string }>(
    await page.request.post("/api/org-admin/invites", { data: { role: "contributor", inviteeEmail: member.email, skipEmailVerification: true } }),
    200,
  );
  const { page: m, context: mctx } = await anon();
  await go(m, invite.inviteUrl);
  await m.locator("#name").fill(member.name);
  await m.locator("#email").fill(member.email);
  await m.locator("#password").fill(member.password);
  await m.getByRole("button", { name: "Join Organization" }).click();
  await expect(m).toHaveURL(/\/login\?verified=true/);
  await uiLogin(m, member);
  expect((await mctx.request.get("/api/notifications/preferences")).status()).toBe(200);
  await m.goto("about:blank");

  // Members > row menu > Copy reset link.
  await go(page, "/org-admin/members");
  const row = page.getByText(member.email, { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
  await row.getByTitle("More actions").click();
  // Email is configured in this stack, so both actions are offered.
  await expect(page.getByRole("menuitem", { name: "Email reset link" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Copy reset link" }).click();
  const dialog = page.getByRole("dialog", { name: "Reset link" });
  await stepUpIfAsked(page, dialog, admin.password);
  await expect(dialog).toContainText(`Send this link to ${member.name}. It works once and expires in 1 hour.`);
  const link = ((await dialog.getByTestId("reset-link").textContent()) ?? "").trim();
  expect(link).toMatch(new RegExp(`^${BASE_URL.replace(/[.:/]/g, "\\$&")}/reset-password\\?token=[0-9a-f]{64}$`));
  await dialog.getByRole("button", { name: "Copy" }).click();
  await expect(toast(page, "Copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();

  // Not offered for your own account.
  const selfRow = page.getByText(admin.email, { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
  await selfRow.getByTitle("More actions").click();
  await expect(page.getByRole("menuitem", { name: "Copy reset link" })).toBeDisabled();
  await page.keyboard.press("Escape");

  // The member opens it in another browser and sets a new password.
  const newPassword = "E2e-Remy-Reset-Passw0rd!";
  const { page: r } = await anon();
  await setNewPassword(r, link, newPassword);
  // Their old session ended.
  expect((await mctx.request.get("/api/notifications/preferences")).status()).toBe(401);
  await uiLogin(r, { ...member, password: newPassword });

  // The link works once.
  guard.allowHttp(/^400 POST .*\/api\/public\/reset-password/);
  const { page: again } = await anon();
  await go(again, link);
  await again.locator("#password").fill("E2e-Another-Passw0rd!");
  await again.locator("#confirmPassword").fill("E2e-Another-Passw0rd!");
  await again.getByRole("button", { name: "Reset password" }).click();
  await expect(again.getByText("This reset link is invalid or expired. Request a new one.")).toBeVisible();

  // Audited, without the link.
  const audit = await expectJson<{ events: { action: string; targetLabel: string; metadata: unknown }[] }>(
    await page.request.get("/api/admin/audit/org", { params: { take: "50" } }),
    200,
  );
  const entry = audit.events.find((e) => e.action === "user.reset_link_created" && e.targetLabel === member.email);
  expect(entry).toBeTruthy();
  expect(JSON.stringify(audit.events)).not.toContain(new URL(link).searchParams.get("token")!);
});

test("forgot password, with email configured: the usual form and a neutral answer", async ({ anon }) => {
  const { page } = await anon();
  await go(page, "/forgot-password");
  await expect(page.getByTestId("no-email-notice")).toHaveCount(0);
  await page.locator("#email").fill(`${uniq("nobody")}@e2e.test`);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("If that email has an account, a reset link is on its way.")).toBeVisible();
});
