// 12b. Two-factor sign-in: an authenticator app (codes computed here from the
// manual-entry key), recovery codes (single use), a WebAuthn security key
// (Chromium's CDP virtual authenticator), and the admin "Require MFA" policy
// funnelling a member without MFA into enrollment; an admin MFA reset.
//
// Set MFA_SHOTS_DIR to also save 1440 / 390 px screenshots of the screens.
import path from "node:path";
import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import { totpAt, totpCounter } from "../src/lib/auth/mfa/totp";
import { expect, settle, test } from "./support/fixtures";
import { uiLogin } from "./support/auth";
import { BASE_URL, expectJson, go, need, toast, uniq, type User } from "./support/helpers";

const SHOTS = process.env.MFA_SHOTS_DIR;

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const original = page.viewportSize();
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, `${name}-${width}.png`), fullPage: true });
  }
  if (original) await page.setViewportSize(original);
}

/** A code the server will accept: within +-1 step and above the last step used. */
async function freshCode(secret: string, used: { last: number }): Promise<string> {
  for (;;) {
    const now = totpCounter(Date.now());
    for (const c of [now, now + 1]) {
      if (c > used.last) {
        used.last = c;
        return totpAt(secret, c);
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function dismissWelcome(page: Page): Promise<void> {
  const welcome = page.getByRole("dialog", { name: "Welcome to Crucible CE" });
  if (await welcome.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await expect(welcome).toBeHidden();
    await settle(page);
  }
}

async function confirmItsMe(page: Page, password: string, code?: string): Promise<void> {
  const dlg = page.getByRole("dialog", { name: "Confirm it's you" });
  await expect(dlg).toBeVisible();
  await dlg.locator("#reauth-password").fill(password);
  if (code) await dlg.locator("#reauth-code").fill(code);
  await dlg.getByRole("button", { name: "Confirm" }).click();
  await expect(dlg).toBeHidden();
}

/**
 * Admin actions ask "confirm it's you" unless a grant from the last 5 minutes
 * is still valid. Answer it if it shows up, then wait for `done`.
 */
async function stepUpIfAsked(page: Page, done: import("@playwright/test").Locator, password: string, code?: () => Promise<string>): Promise<void> {
  const dlg = page.getByRole("dialog", { name: "Confirm it's you" });
  await expect(dlg.or(done).first()).toBeVisible();
  if (await dlg.isVisible()) await confirmItsMe(page, password, code ? await code() : undefined);
  await expect(done).toBeVisible();
}

/**
 * Settings > Security: set up the authenticator app. Within 5 minutes of
 * signing in there is no "confirm it's you" prompt (the sign-in counts);
 * after that, the password is asked for again.
 */
async function enrollTotp(page: Page, user: User, opts: { freshSignIn: boolean; screenshot?: boolean }) {
  await page.getByRole("button", { name: "Set up authenticator app" }).click();
  if (opts.freshSignIn) await expectNoReauthPrompt(page);
  else {
    // An older session: asked again unless this browser signed in within the last 5 minutes.
    const dlg = page.getByRole("dialog", { name: "Confirm it's you" });
    await expect(dlg.or(page.getByTestId("totp-setup"))).toBeVisible();
    if (await dlg.isVisible()) await confirmItsMe(page, user.password);
  }
  return finishTotpSetup(page, opts.screenshot ? "totp-enrollment" : null);
}

async function expectNoReauthPrompt(page: Page): Promise<void> {
  await expect(page.getByTestId("totp-setup").or(page.getByTestId("add-security-key"))).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Confirm it's you" })).toHaveCount(0);
}

async function finishTotpSetup(page: Page, shotName: string | null) {
  const setup = page.getByTestId("totp-setup");
  await expect(setup).toBeVisible();
  await expect(setup.getByRole("img", { name: /QR code/ })).toBeVisible();
  const secret = ((await page.getByTestId("totp-secret").textContent()) ?? "").replace(/\s/g, "");
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  if (shotName) await shot(page, shotName);
  const used = { last: -1 };
  await page.locator("#totp-code").fill(await freshCode(secret, used));
  await page.getByRole("button", { name: "Verify and turn on" }).click();
  const codesDialog = page.getByRole("dialog", { name: "Save your recovery codes" });
  await expect(codesDialog).toBeVisible();
  const codes = (await page.getByTestId("recovery-codes").locator("li").allTextContents()).map((c) => c.trim());
  expect(codes).toHaveLength(10);
  await codesDialog.getByRole("button", { name: "I've saved them" }).click();
  await expect(codesDialog).toBeHidden();
  return { secret, used, codes };
}

async function signOut(page: Page, user: User): Promise<void> {
  await page.getByRole("button", { name: new RegExp(user.name) }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await settle(page);
}

/** Password step only: lands on the second step. */
async function passwordStep(page: Page, user: User): Promise<void> {
  await go(page, "/login");
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("mfa-step")).toBeVisible();
}

test("authenticator app: enroll, sign in with password + code; a recovery code works exactly once", async ({ anon }) => {
  const contributor = need("contributor");
  const { page } = await anon();
  await uiLogin(page, contributor);
  await dismissWelcome(page);

  await go(page, "/settings?tab=security");
  await expect(page.getByTestId("mfa-status")).toHaveText("Off");
  // 390 px: the tab bar wraps (2x2), nothing cut off or scrolled.
  const tabs = page.getByRole("tablist");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ["Profile", "Security", "Notifications", "Appearance"]) {
    const box = await tabs.getByRole("tab", { name }).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390, name).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (SHOTS) await tabs.screenshot({ path: path.join(SHOTS, "settings-tabs-390.png") });
  await page.setViewportSize({ width: 1280, height: 720 });
  const { secret, used, codes } = await enrollTotp(page, contributor, { freshSignIn: true, screenshot: true });
  await expect(page.getByTestId("mfa-status")).toHaveText("On");
  await expect(page.getByTestId("recovery-status")).toContainText("10 of 10 unused");
  await shot(page, "settings-security");

  // Sign out; this browser keeps its known-device cookie, which must not skip MFA.
  await signOut(page, contributor);
  await passwordStep(page, contributor);
  // Password accepted, but no session until the second factor.
  expect(await (await page.request.get("/api/auth/session")).text()).toMatch(/^(null|\{\})$/);
  await shot(page, "signin-second-step");
  const code = await freshCode(secret, used);
  await page.locator("#mfa-code").fill(code);
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await settle(page);

  // The same code can't be replayed in another browser.
  {
    const { page: p } = await anon();
    await passwordStep(p, contributor);
    await p.locator("#mfa-code").fill(code);
    await p.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(p.getByTestId("mfa-step").getByRole("alert")).toContainText("That code didn't work");
    await expect(p).toHaveURL(/\/login/);
  }

  // A recovery code signs in once...
  {
    const { page: p } = await anon();
    await passwordStep(p, contributor);
    await p.getByRole("button", { name: "Use a recovery code" }).click();
    await p.locator("#recovery-code").fill(codes[0]);
    await p.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(p).toHaveURL(/\/dashboard/);
    await settle(p);
  }
  // ...and is rejected the second time.
  {
    const { page: p } = await anon();
    await passwordStep(p, contributor);
    await p.getByRole("button", { name: "Use a recovery code" }).click();
    await p.locator("#recovery-code").fill(codes[0].toLowerCase());
    await p.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(p.getByTestId("mfa-step").getByRole("alert")).toContainText("That code didn't work");
    await expect(p).toHaveURL(/\/login/);
    const session = await (await p.request.get("/api/auth/session")).text();
    expect(session).toMatch(/^(null|\{\})$/);
  }

  await go(page, "/settings?tab=security");
  await expect(page.getByTestId("recovery-status")).toContainText("9 of 10 unused");
});

test("security key (WebAuthn virtual authenticator): register, then sign in with it", async ({ anon }) => {
  const reader = need("reader");
  const { page, context } = await anon();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "usb",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await uiLogin(page, reader);
  await dismissWelcome(page);
  await go(page, "/settings?tab=security");
  await page.getByRole("button", { name: "Add security key" }).click();
  // Just signed in: no password prompt.
  await expectNoReauthPrompt(page);
  const keyDialog = page.getByRole("dialog", { name: "Add a security key or passkey" });
  await expect(keyDialog).toBeVisible();
  await keyDialog.locator("#webauthn-name").fill("E2E virtual key");
  await keyDialog.getByRole("button", { name: "Register key" }).click();
  // First factor: recovery codes are issued.
  const codesDialog = page.getByRole("dialog", { name: "Save your recovery codes" });
  await expect(codesDialog).toBeVisible();
  await codesDialog.getByRole("button", { name: "I've saved them" }).click();
  await expect(page.getByTestId("security-keys")).toContainText("E2E virtual key");
  await expect(page.getByTestId("mfa-status")).toHaveText("On");
  const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  expect(credentials).toHaveLength(1);
  const countBefore = credentials[0].signCount;

  await signOut(page, reader);
  await passwordStep(page, reader);
  await page.getByRole("button", { name: "Use your security key" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await settle(page);
  const after = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  expect(after.credentials[0].signCount).toBeGreaterThan(countBefore);

  await go(page, "/settings?tab=security");
  await expect(page.getByTestId("security-keys")).not.toContainText("Last used never");
});

test("require MFA: the admin needs MFA to turn it on; a member without MFA is funnelled to enrollment; admin reset", async ({ as, anon, guard }) => {
  const admin = need("admin");
  const { page } = await as("admin");

  // Turning the policy on without MFA of your own is refused.
  guard.allowHttp(/^409 PUT .*\/api\/admin\/security-policy/);
  await go(page, "/org-admin/members");
  await page.getByRole("switch", { name: "Require two-factor sign-in for all members" }).click();
  await page.getByRole("button", { name: "Require two-factor" }).click();
  await stepUpIfAsked(page, toast(page, "Turn on two-factor sign-in for your own account first"), admin.password);
  await expect(page.getByRole("switch", { name: "Require two-factor sign-in for all members" })).not.toBeChecked();

  // A new member without MFA, signed in before the policy goes on.
  const member: User = { name: "Nia Newcomer", email: `${uniq("nia")}@e2e.test`, password: "E2e-Newcomer-Passw0rd!" };
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

  // The admin turns on their own MFA, then the policy.
  await go(page, "/settings?tab=security");
  const adminTotp = await enrollTotp(page, admin, { freshSignIn: false });
  const adminCode = () => freshCode(adminTotp.secret, adminTotp.used);
  await go(page, "/org-admin/members");
  await expect(page.getByTestId("mfa-policy")).toContainText("Members without two-factor sign-in are signed out and must set it up");
  await page.getByRole("switch", { name: "Require two-factor sign-in for all members" }).click();
  await page.getByRole("button", { name: "Require two-factor" }).click();
  await stepUpIfAsked(page, toast(page, "Two-factor sign-in required"), admin.password, adminCode);
  await expect(page.getByRole("switch", { name: "Require two-factor sign-in for all members" })).toBeChecked();
  const policy = await expectJson<{ requireMfa: boolean }>(await page.request.get("/api/admin/security-policy"), 200);
  expect(policy.requireMfa).toBe(true);
  // The admin (who has MFA) is still signed in; the member without MFA was signed out.
  expect((await page.request.get("/api/notifications/preferences")).status()).toBe(200);
  expect((await mctx.request.get("/api/notifications/preferences")).status()).toBe(401);

  // Signing in again lands on the enrollment page.
  await go(m, "/login");
  await m.locator("#email").fill(member.email);
  await m.locator("#password").fill(member.password);
  await m.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(m).toHaveURL(/\/mfa-setup-required/, { timeout: 30_000 });
  await expect(m.getByRole("heading", { name: "Turn on two-factor sign-in" })).toBeVisible();
  await settle(m);
  await shot(m, "require-mfa-funnel");
  // Every other page and API is walled off until they enroll.
  const blocked = await mctx.request.get("/api/incidents");
  expect(blocked.status()).toBe(403);
  expect(await blocked.json()).toMatchObject({ code: "mfa_enrollment_required" });
  await go(m, "/incidents");
  await expect(m).toHaveURL(/\/mfa-setup-required/);

  await m.getByRole("button", { name: /Authenticator app/ }).click();
  // Right after signing in: straight to the QR code, no password prompt.
  await expectNoReauthPrompt(m);
  await finishTotpSetup(m, null);
  await expect(m).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await settle(m);
  expect((await mctx.request.get("/api/incidents")).status()).toBe(200);

  // Members shows MFA status; the admin resets the newcomer's MFA (sessions end).
  await m.goto("about:blank");
  await go(page, "/org-admin/members");
  const row = page.getByText(member.email, { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
  await expect(row.getByTestId("member-mfa")).toHaveText("Two-factor");
  await row.getByTitle("More actions").click();
  await page.getByRole("menuitem", { name: "Reset two-factor" }).click();
  await page.getByRole("button", { name: "Reset two-factor" }).click();
  await stepUpIfAsked(page, toast(page, `Two-factor sign-in reset for ${member.email}`), admin.password, adminCode);
  await expect(row.getByTestId("member-mfa")).toHaveText("No two-factor");
  expect((await mctx.request.get("/api/notifications/preferences")).status()).toBe(401);
  const audit = await expectJson<{ events: { action: string; targetLabel: string }[] }>(
    await page.request.get("/api/admin/audit/org", { params: { take: "50" } }),
    200,
  );
  expect(audit.events.some((e) => e.action === "user.mfa_reset" && e.targetLabel === member.email)).toBe(true);
  expect(audit.events.some((e) => e.action === "org.require_mfa_enabled")).toBe(true);

  // Leave the org as later specs expect it: policy off.
  await page.getByRole("switch", { name: "Require two-factor sign-in for all members" }).click();
  await stepUpIfAsked(page, toast(page, "Two-factor sign-in optional"), admin.password, adminCode);

  // Without a fresh grant, the admin endpoints refuse (step-up required).
  const { context: bare } = await anon();
  await bare.addCookies((await page.context().cookies()).filter((c) => c.name !== "crucible_mfa_reauth"));
  const refused = await bare.request.put("/api/admin/security-policy", { data: { requireMfa: false }, headers: { Origin: BASE_URL } });
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toMatchObject({ code: "reauth_required" });
});
