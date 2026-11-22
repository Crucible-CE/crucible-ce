// 12c. Server recovery command, run inside the app container of this stack
// (read-only image): `docker compose -p ce-e2e exec app npm run reset-password
// -- --email ...`. The printed link works; a password reset never skips
// two-factor sign-in; --reset-mfa removes it. Runs after 12b, where the
// contributor turned on an authenticator app.
import type { Page } from "@playwright/test";
import { appExec } from "./stack";
import { expect, settle, test } from "./support/fixtures";
import { uiLogin } from "./support/auth";
import { BASE_URL, expectJson, go, need, saveRun } from "./support/helpers";

function resetPassword(...args: string[]) {
  return appExec(["npm", "run", "reset-password", "--", ...args]);
}

function printedLink(stdout: string): string {
  const m = stdout.match(/^(https?:\/\/\S+\/reset-password\?token=[0-9a-f]{64})$/m);
  expect(m, stdout).toBeTruthy();
  return m![1];
}

async function setNewPassword(page: Page, link: string, password: string): Promise<void> {
  await go(page, link);
  await page.locator("#password").fill(password);
  await page.locator("#confirmPassword").fill(password);
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByRole("heading", { name: "Password reset" })).toBeVisible();
  await settle(page);
}

test("recovery command in the container: link works, two-factor still asked; --reset-mfa removes it", async ({ as, anon }) => {
  const contributor = need("contributor");

  // Unknown email: a clear error, exit 1.
  const unknown = resetPassword("--email", "nobody-here@e2e.test");
  expect(unknown.status, unknown.stderr).toBe(1);
  expect(unknown.stderr).toContain("No account uses nobody-here@e2e.test.");

  // A link for the contributor, under PUBLIC_URL.
  const first = resetPassword("--email", contributor.email);
  expect(first.status, first.stderr).toBe(0);
  expect(first.stdout).toContain(`Reset link for ${contributor.email}. It works once and expires in 1 hour.`);
  const link = printedLink(first.stdout);
  expect(link.startsWith(`${BASE_URL}/reset-password?token=`)).toBe(true);

  const afterReset = "E2e-Contrib-Reset-Passw0rd!";
  const { page } = await anon();
  await setNewPassword(page, link, afterReset);

  // The new password is accepted, but the second factor is still required.
  await go(page, "/login");
  await page.locator("#email").fill(contributor.email);
  await page.locator("#password").fill(afterReset);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("mfa-step")).toBeVisible();
  expect(await (await page.request.get("/api/auth/session")).text()).toMatch(/^(null|\{\})$/);
  saveRun({ contributor: { ...contributor, password: afterReset } });

  // --reset-mfa: two-factor removed, so the next sign-in is password only.
  const second = resetPassword("--email", contributor.email, "--reset-mfa");
  expect(second.status, second.stderr).toBe(0);
  expect(second.stdout).toContain("Two-factor sign-in was removed and all sessions ended.");
  const finalPassword = "E2e-Contrib-Final-Passw0rd!";
  const { page: p2 } = await anon();
  await setNewPassword(p2, printedLink(second.stdout), finalPassword);
  await uiLogin(p2, { ...contributor, password: finalPassword });
  saveRun({ contributor: { ...contributor, password: finalPassword } });

  // Both actions are in the audit log as the server console.
  const { page: admin } = await as("admin");
  await go(admin, "/org-admin/members");
  const audit = await expectJson<{ events: { action: string; actorName: string | null; targetLabel: string }[] }>(
    await admin.request.get("/api/admin/audit/org", { params: { take: "50" } }),
    200,
  );
  const mine = audit.events.filter((e) => e.targetLabel === contributor.email && e.actorName === "server console");
  expect(mine.map((e) => e.action)).toEqual(expect.arrayContaining(["user.reset_link_created", "user.mfa_reset"]));
});
