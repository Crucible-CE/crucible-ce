// 12. Sign out: protected pages redirect to /login, and the old session
// cookie stops working (sign-out revokes every token server-side).
import { readFileSync } from "node:fs";
import { expect, settle, storageStatePath, test } from "./support/fixtures";
import { go, need } from "./support/helpers";

test("sign out redirects protected pages and revokes the old session cookie", async ({ as, browser, guard }) => {
  const admin = need("admin");
  const { page, context } = await as("admin");
  await go(page, "/dashboard");
  const oldCookies = await context.cookies();
  expect(oldCookies.some((c) => c.name === "authjs.session-token")).toBe(true);
  expect((await page.request.get("/api/notifications/preferences")).status()).toBe(200);

  await page.getByRole("button", { name: new RegExp(admin.name) }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await settle(page);

  // Protected pages now bounce to /login.
  for (const path of ["/dashboard", "/incidents", "/org-admin/members"]) {
    await go(page, path);
    await expect(page).toHaveURL(/\/login\?from=/);
  }

  // Replay the pre-logout cookie in a fresh context: the JWT still decrypts,
  // but its token version was bumped at sign-out, so the server refuses it.
  const replay = await browser.newContext({ storageState: JSON.parse(readFileSync(storageStatePath("admin"), "utf8")) });
  guard.watch(replay);
  try {
    expect((await replay.cookies()).some((c) => c.name === "authjs.session-token")).toBe(true);
    const prefs = await replay.request.get("/api/notifications/preferences");
    expect(prefs.status()).toBe(401);
    const invites = await replay.request.get("/api/org-admin/invites");
    expect(invites.status()).toBe(403);
    const session = await replay.request.get("/api/auth/session");
    const body = await session.text();
    expect(body === "null" || body === "{}" || body === "", `session for a revoked cookie: ${body}`).toBe(true);

    const p = await replay.newPage();
    // The org-admin layout redirects a revoked session to /login on the server.
    await go(p, "/org-admin/members");
    await expect(p).toHaveURL(/\/login/);
  } finally {
    await replay.close();
  }
});
