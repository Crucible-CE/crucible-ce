// 3. Escalation contact (E.164 phone, Mailpit email): email and phone are
// verified SEPARATELY; the admin marks the phone verified (SMS isn't
// configured in this stack). The admin's own notification phone: SMS code
// verification is unavailable without Twilio, so the admin override opens it.
// The matrix has no horizontal overflow at 1280px.
import { expect, test } from "./support/fixtures";
import { expectJson, go, saveRun, toast } from "./support/helpers";

const contact = { name: "Pat Pager", email: "pat.pager@e2e.test", phone: "+15551230001" };

test("admin adds a verified escalation contact and their own notification phone", async ({ as, guard }) => {
  const { page } = await as("admin");
  await go(page, "/escalation-matrix");
  await expect(page.getByRole("heading", { name: "Escalation matrix", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Add contact" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add contact" });
  await dialog.locator("#ec-name").fill(contact.name);
  await dialog.locator("#ec-email").fill(contact.email);
  await dialog.locator("#ec-phone").fill(contact.phone);
  await dialog.getByRole("button", { name: "Add contact" }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByText(contact.name)).toBeVisible();
  await expect(page.getByText("Email never verified")).toBeVisible();
  await expect(page.getByText("Phone never verified")).toBeVisible();
  await expect(page.getByText("SMS/voice off until verified")).toBeVisible();

  // No horizontal overflow at the default 1280px viewport (the matrix used to
  // break out under the fixed sidebar).
  expect(page.viewportSize()?.width).toBe(1280);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // A plain pointer click works now that nothing overflows.
  await page.getByRole("button", { name: "Mark phone verified" }).click();
  await expect(toast(page, `${contact.name}: phone marked verified`)).toBeVisible();
  await expect(page.getByText("Phone verified today")).toBeVisible();
  // The email is still unverified: the two are separate.
  await expect(page.getByText("Email never verified")).toBeVisible();
  await expect(page.getByText("SMS/voice off until verified")).toHaveCount(0);

  const contacts = await expectJson<{ id: string; name: string; phone: string; emailVerifiedAt: string | null; phoneVerifiedAt: string | null }[]>(
    await page.request.get("/api/escalation-contacts"),
    200,
  );
  const saved = contacts.find((c) => c.name === contact.name);
  expect(saved?.phone).toBe(contact.phone);
  expect(saved?.phoneVerifiedAt).toBeTruthy();
  expect(saved?.emailVerifiedAt).toBeNull();
  saveRun({ contactId: saved!.id, contactEmail: contact.email, contactName: contact.name });

  // The admin's own mobile number for SMS / voice alerts.
  await go(page, "/settings/notifications");
  await expect(page.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible();
  await page.getByPlaceholder("+15551234567").fill("+15551230099");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(toast(page, "Notification settings saved")).toBeVisible();
  const prefs = await expectJson<{ settings: { notificationPhone: string | null; notificationPhoneVerified: boolean; smsConfigured: boolean } }>(
    await page.request.get("/api/notifications/preferences"),
    200,
  );
  expect(prefs.settings.notificationPhone).toBe("+15551230099");
  expect(prefs.settings.notificationPhoneVerified).toBe(false);
  // No Twilio in this stack: the UI says so instead of offering a code.
  expect(prefs.settings.smsConfigured).toBe(false);
  await expect(page.getByTestId("sms-not-configured")).toContainText("SMS is not set up on this server");
  await expect(page.getByRole("button", { name: "Send code" })).toHaveCount(0);
  const sendCode = await page.request.post("/api/notifications/phone-verification");
  expect(sendCode.status()).toBe(409);
  expect(((await sendCode.json()) as { code: string }).code).toBe("sms_not_configured");
  guard.allowHttp(/^409 POST .*\/api\/notifications\/phone-verification$/);

  // The administrator override for a member phone (here: their own).
  const me = await expectJson<{ user: { id: string } }>(await page.request.get("/api/auth/session"), 200);
  await expectJson(await page.request.post(`/api/admin/users/${me.user.id}/notification-phone`, { data: { allowUnverified: true } }), 200);
  await page.reload();
  await expect(page.getByText("an administrator allowed SMS/voice to this number")).toBeVisible();
});
