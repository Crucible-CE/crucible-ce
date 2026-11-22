// 1. A fresh install routes everything to /setup; the one-time setup code from
// the app log claims it; afterwards /setup is gone for good.
import { loginAndSave } from "./support/auth";
import { expect, settle, test } from "./support/fixtures";
import { expectJson, saveRun, stack, type User } from "./support/helpers";

const admin: User = {
  name: "Ada Admin",
  email: "ada.admin@e2e.test",
  password: "E2e-Admin-Passw0rd!",
};

test("fresh install routes / and /login to /setup, setup with the log code, then /setup is closed", async ({
  page,
  request,
}) => {
  const status = await expectJson<{ needsSetup: boolean }>(await request.get("/api/public/setup"), 200);
  expect(status.needsSetup).toBe(true);

  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await page.goto("/login");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("heading", { name: "Set up Crucible CE" })).toBeVisible();

  await page.locator("#setupCode").fill(stack().setupCode);
  await page.locator("#orgName").fill("E2E Security");
  await page.locator("#name").fill(admin.name);
  await page.locator("#email").fill(admin.email);
  await page.locator("#password").fill(admin.password);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page).toHaveURL(/\/login\?setup=done/);
  saveRun({ admin });

  // The wizard is permanently off: the API answers 410, the page redirects away.
  const again = await request.post("/api/public/setup", {
    data: { orgName: "Hijack", name: "Mallory", email: "m@evil.example", password: "Hijack-Passw0rd!", setupCode: stack().setupCode },
  });
  expect(again.status()).toBe(410);
  expect((await expectJson<{ needsSetup: boolean }>(await request.get("/api/public/setup"), 200)).needsSetup).toBe(false);

  await loginAndSave(page, "admin", admin);

  // The first admin lands on the Ops Room with the one-time welcome modal and
  // the "Onboarding" card. Email (SMTP), the webhook and the signing key come
  // from this stack's environment, so 3 of the 9 setup steps are already done.
  await expect(page).toHaveURL(/\/dashboard/);
  const welcome = page.getByRole("dialog", { name: "Welcome to Crucible CE" });
  await expect(welcome).toBeVisible();
  await expect(welcome).toContainText("Run it outside your network.");
  await expect(welcome).toContainText("No SSO, on purpose.");
  await expect(welcome.getByRole("button", { name: "Start setup" })).toBeVisible();
  const card = page.getByTestId("get-ready-card");
  await expect(card).toContainText("Onboarding · 3 of 9 done");
  await welcome.getByRole("button", { name: "Skip for now" }).click();
  await expect(welcome).toBeHidden();
  await expect(page.getByText("Nothing needs you.")).toBeVisible();
  await expect(page.getByText("No open incidents.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Declare incident" })).toBeVisible();
  // Brand-new install: readiness needs attention (no contacts, nothing sent yet).
  await expect(page.getByTestId("readiness-summary")).toHaveAttribute("data-ready", "false");
  await expect(page.getByTestId("readiness-items")).toContainText("No escalation contacts");
  // Dismissed for good: a reload shows no modal, the card stays.
  await settle(page);
  await page.reload();
  await expect(card).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Welcome to Crucible CE" })).toHaveCount(0);
  await settle(page); // let the reloaded page's own fetches finish before navigating away

  // Signed in: /setup -> /login (server redirect) -> /dashboard (client).
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/dashboard/);
  await page.waitForLoadState("load");
  await settle(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard/);
});
