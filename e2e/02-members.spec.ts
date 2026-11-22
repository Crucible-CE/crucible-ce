// 2. The admin invites a contributor (no email verification) and a reader
// (verifies through the Mailpit inbox); both register and sign in, each in
// their own browser context.
import type { Page } from "@playwright/test";
import { loginAndSave } from "./support/auth";
import { expect, test } from "./support/fixtures";
import { expectJson, firstLink, go, loadRun, pickOption, saveRun, waitForMail, type User } from "./support/helpers";

const contributor: User = { name: "Cole Contributor", email: "cole.contributor@e2e.test", password: "E2e-Contrib-Passw0rd!" };
const reader: User = { name: "Rhea Reader", email: "rhea.reader@e2e.test", password: "E2e-Reader-Passw0rd!" };

async function createInvite(page: Page, role: "contributor" | "reader", email: string, skipVerification: boolean) {
  await page.getByRole("button", { name: "New invite" }).click();
  const dialog = page.getByRole("dialog", { name: "New invite" });
  await expect(dialog).toBeVisible();
  if (role !== "contributor") await pickOption(dialog.getByRole("combobox").first(), role);
  await dialog.locator("#inviteeEmail").fill(email);
  if (skipVerification) await dialog.getByRole("switch", { name: "Skip email verification" }).click();
  await dialog.getByRole("button", { name: "Generate link" }).click();
  await expect(dialog).toBeHidden();
  const message = await page.locator("textarea[readonly]").inputValue();
  expect(message).toContain(`as ${role}`);
  const url = message.match(/https?:\/\/\S+\/register\?orgInvite=\S+/)?.[0];
  expect(url, message).toBeTruthy();
  await page.getByRole("button", { name: "Dismiss" }).click();
  return url!;
}

async function register(page: Page, inviteUrl: string, user: User) {
  await go(page, inviteUrl);
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
  await page.locator("#name").fill(user.name);
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.getByRole("button", { name: "Join Organization" }).click();
}

test("admin invites a contributor and a reader; both register and sign in", async ({ as, anon }) => {
  const { page: admin } = await as("admin");
  await go(admin, "/org-admin/members");
  await expect(admin.getByRole("heading", { name: "Members", exact: true })).toBeVisible();

  const contributorInvite = await createInvite(admin, "contributor", contributor.email, true);
  const readerInvite = await createInvite(admin, "reader", reader.email, false);
  await expect(admin.getByText("no email verification")).toHaveCount(1);

  // Contributor: verification skipped, straight to the sign-in page.
  const { page: c } = await anon();
  await register(c, contributorInvite, contributor);
  await expect(c).toHaveURL(/\/login\?verified=true/);
  await expect(c.getByText("Email verified. You can sign in now.")).toBeVisible();
  await loginAndSave(c, "contributor", contributor);

  // Reader: must verify through the email first.
  const since = new Date();
  const { page: r } = await anon();
  await register(r, readerInvite, reader);
  await expect(r).toHaveURL(/\/check-email/);
  await expect(r.getByRole("heading", { name: "Check your email" })).toBeVisible();

  // A role change while the reader is still unverified (an audited event that
  // spec 11 looks for): reader -> contributor -> reader.
  const members = await expectJson<{ id: string; email: string; name: string }[]>(
    await admin.request.get("/api/org-members"),
    200,
  );
  const idOf = (email: string) => members.find((m) => m.email === email)?.id;
  const readerId = idOf(reader.email);
  expect(readerId).toBeTruthy();
  for (const role of ["contributor", "reader"]) {
    await expectJson(await admin.request.patch(`/api/admin/users/${readerId}`, { data: { role } }), 200);
  }

  const mail = await waitForMail(r.request, reader.email, { since });
  const verifyLink = firstLink(mail.Text || mail.HTML, "/api/public/verify-email");
  await go(r, verifyLink);
  await expect(r).toHaveURL(/\/login\?verified=true/);
  await loginAndSave(r, "reader", reader);

  saveRun({
    contributor: { ...contributor, id: idOf(contributor.email) },
    reader: { ...reader, id: readerId },
    admin: { ...loadRun().admin!, id: idOf(loadRun().admin!.email) },
  });
  expect(loadRun().admin?.id).toBeTruthy();
  expect(loadRun().contributor?.id).toBeTruthy();

  // The invite list now shows both as used.
  await go(admin, "/org-admin/members");
  await expect(admin.getByText("used", { exact: true })).toHaveCount(2);
});
