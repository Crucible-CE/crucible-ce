// 8. Calendar: .ics download, a subscribe link whose feed works anonymously,
// and revocation that kills the feed.
import { readFileSync } from "node:fs";
import { expect, test } from "./support/fixtures";
import { BASE_URL, expectJson, go, need, toast } from "./support/helpers";

test("calendar: .ics download, subscribe link feed, revoke", async ({ as, guard, request }) => {
  const id = need("incidentId");
  const title = need("incidentTitle");
  const { page, context } = await as("admin");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_URL });

  await go(page, `/incidents/${id}/calendar`);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: /Export \.ics/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`incident-${id}.ics`);
  const ics = readFileSync(await download.path(), "utf8");
  expect(ics).toContain("BEGIN:VCALENDAR");
  expect(ics).toContain("BEGIN:VEVENT");
  expect(ics).toContain("Reset VPN credentials"); // the task's due date/time

  // Subscribe link from the UI (copied to the clipboard).
  await page.getByRole("button", { name: "Copy subscribe link" }).click();
  await expect(toast(page, /Subscription link copied/)).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const feedUrl = copied.match(/https?:\/\/\S+\/api\/public\/ics\/incident\/\S+/)?.[0] ?? copied.replace(/^webcal:/, "http:");
  expect(feedUrl).toContain(`/api/public/ics/incident/${id}/`);

  // The feed works without a session.
  const feed = await request.get(feedUrl);
  expect(feed.status()).toBe(200);
  expect(feed.headers()["content-type"]).toContain("text/calendar");
  const feedBody = await feed.text();
  expect(feedBody).toContain("BEGIN:VCALENDAR");
  expect(feedBody).toContain(title);

  // Revoke: the feed is gone.
  const revoked = await expectJson<{ ok: boolean; revoked: number }>(await page.request.delete(`/api/incidents/${id}/calendar/subscribe`), 200);
  expect(revoked.revoked).toBeGreaterThanOrEqual(1);
  const after = await request.get(feedUrl);
  expect(after.status()).toBe(404);
  guard.allowHttp(/^404 GET .*\/api\/public\/ics\//);
});
