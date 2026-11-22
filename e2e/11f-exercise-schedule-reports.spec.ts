// 11f. Schedule and reports: a quarterly entry and its .ics file, the private
// ICS feed (made, read, then turned off), the program report and executive
// summary PDFs, and the work item from the after-action spec (11d).
import { expect, test } from "./support/fixtures";
import { expectJson, go, uniq } from "./support/helpers";

test("schedule with .ics and feed, program report PDFs, work items", async ({ as, anon, guard }) => {
  test.setTimeout(180_000);
  const { page } = await as("contributor");

  // A quarterly Crisis Sim on the schedule.
  await go(page, "/schedule");
  await page.getByRole("button", { name: "Add to schedule" }).first().click();
  const title = uniq("Quarterly crisis drill");
  await page.getByLabel("Title").fill(title);
  const next = new Date(Date.now() + 14 * 86_400_000);
  const date = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
  await page.getByLabel("Repeats").selectOption({ label: "Quarterly" });
  await page.getByLabel(/^(Date|First date)$/).fill(date);
  await page.getByLabel("Start").fill("09:30");
  await page.getByLabel("Pre-read brief").fill("Read the incident response plan before the session.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Quarterly").first()).toBeVisible();

  // The .ics file carries the recurrence and the brief.
  const entry = page.locator("li, article, section, div").filter({ has: page.getByRole("heading", { name: title }) }).filter({ has: page.getByRole("link", { name: ".ics" }) }).last();
  const icsHref = await entry.getByRole("link", { name: ".ics" }).first().getAttribute("href");
  expect(icsHref).toBeTruthy();
  const ics = await page.request.get(icsHref!);
  expect(ics.status()).toBe(200);
  expect(ics.headers()["content-type"]).toContain("text/calendar");
  const body = (await ics.text()).replace(/\r\n /g, "");
  expect(body).toContain("BEGIN:VCALENDAR");
  expect(body.match(/BEGIN:VEVENT/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  expect(body).toContain("Read the incident response plan");

  // The private feed works without a session, and stops when turned off.
  const feed = await expectJson<{ path: string }>(await page.request.post("/api/schedule/feed"), 200);
  const { page: outsider } = await anon();
  const viaFeed = await outsider.request.get(feed.path);
  expect(viaFeed.status()).toBe(200);
  expect((await viaFeed.text()).replace(/\r\n /g, "")).toContain(title);
  await expectJson(await page.request.delete("/api/schedule/feed"), 200);
  guard.allowHttp(/^40[134] GET .*\/api\/public\/ics\/exercises\?token=/);
  expect((await outsider.request.get(feed.path)).ok()).toBe(false);

  // Program report on screen and as PDFs.
  await go(page, "/reports");
  await expect(page.getByRole("heading", { name: "Program report", exact: true })).toBeVisible({ timeout: 30_000 });
  for (const name of ["Program report PDF", "Executive summary PDF"]) {
    const href = await page.getByRole("link", { name }).getAttribute("href");
    const r = await page.request.get(href!);
    expect(r.status(), name).toBe(200);
    expect((await r.body()).subarray(0, 5).toString("latin1"), name).toBe("%PDF-");
  }

  // Work items: the action from the after-action spec.
  await go(page, "/action-items");
  await expect(page.getByText("Assign a holding statement owner in the IR plan.").first()).toBeVisible({ timeout: 30_000 });
});
