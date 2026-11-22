// 7. Lock the incident: a reader who is not on the access list cannot see it
// at all (404), the contributor participant sees it read-only, and a page to
// a non-participant is redacted.
import { expect, test } from "./support/fixtures";
import { expectJson, go, need, toast, waitForMail } from "./support/helpers";

test.describe.configure({ mode: "serial" });

const LOCK_MESSAGE = "Only the incident commander or an Org admin can edit it.";

test("admin locks the incident from the Access panel", async ({ as }) => {
  const id = need("incidentId");
  const { page } = await as("admin");
  await go(page, `/incidents/${id}`);
  await page.getByRole("button", { name: "Lock", exact: true }).click();
  await page.getByRole("button", { name: "Lock incident" }).click();
  await expect(page.getByText("Locked", { exact: true }).first()).toBeVisible();
  const p = await expectJson<{ restricted: boolean; participants: { userId: string }[] }>(
    await page.request.get(`/api/incidents/${id}/participants`),
    200,
  );
  expect(p.restricted).toBe(true);
  expect(p.participants.map((x) => x.userId)).toContain(need("contributor").id);
  expect(p.participants.map((x) => x.userId)).not.toContain(need("reader").id);
});

test("a reader outside the access list gets 404 in the API and the UI", async ({ as, guard }) => {
  const id = need("incidentId");
  const title = need("incidentTitle");
  const { page } = await as("reader");
  guard.allowHttp(new RegExp(`^404 GET .*/api/incidents/${id}`));

  expect((await page.request.get(`/api/incidents/${id}`)).status()).toBe(404);
  expect((await page.request.get(`/api/incidents/${id}/chat`)).status()).toBe(404);
  const list = await expectJson<{ id: string }[]>(await page.request.get("/api/incidents"), 200);
  expect(list.map((i) => i.id)).not.toContain(id);

  await go(page, `/incidents/${id}`);
  await expect(page.getByText("Incident not found.")).toBeVisible();
  await expect(page.getByText(title)).toHaveCount(0);
});

test("the contributor participant sees it read-only; a write shows the lock message", async ({ as }) => {
  const id = need("incidentId");
  const { page } = await as("contributor");
  await go(page, `/incidents/${id}`);
  await expect(page.getByRole("status").filter({ hasText: "Locked." })).toContainText(LOCK_MESSAGE);
  await expect(page.getByRole("heading", { name: need("incidentTitle"), level: 1 })).toBeVisible();
  // Edit controls are hidden.
  await expect(page.getByPlaceholder("Add an action…")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Close incident…" })).toHaveCount(0);
  await expect(page.getByText("Next step")).toHaveCount(0);

  await go(page, `/incidents/${id}/chat`);
  await expect(page.getByText("Locked. You can read the chat but not post.")).toBeVisible();
  await go(page, `/incidents/${id}/evidence`);
  await expect(page.getByText("Drop files or click to upload")).toHaveCount(0);

  // A write attempt is refused with the lock error.
  const res = await page.request.post(`/api/incidents/${id}/tasks`, { data: { title: "should not be created" } });
  expect(res.status()).toBe(403);
  const body = (await res.json()) as { code: string; message: string };
  expect(body.code).toBe("incident_locked");
  expect(body.message).toContain(LOCK_MESSAGE);

  // ... and the SITREP composer and Page buttons are hidden from read-only viewers.
  await go(page, `/incidents/${id}/sitrep`);
  await expect(page.getByRole("heading", { name: "Situation reports" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New SITREP" })).toHaveCount(0);
  await go(page, `/incidents/${id}/escalation`);
  await expect(page.getByRole("heading", { name: "Page responders" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Page", exact: true })).toHaveCount(0);
});

test("paging a non-participant sends a redacted email (no incident title)", async ({ as, request }) => {
  const id = need("incidentId");
  const title = need("incidentTitle");
  const reader = need("reader");
  const since = new Date();
  const { page } = await as("admin");
  await go(page, `/incidents/${id}/escalation`);
  const row = page.locator("li").filter({ hasText: reader.email });
  await row.getByRole("button", { name: "Page", exact: true }).click();
  await expect(toast(page, `Paged ${reader.name}`)).toBeVisible();

  const mail = await waitForMail(request, reader.email, { since, subject: /page/i });
  expect(mail.Subject).toBe("[HIGH] Restricted incident page");
  expect(mail.Text).toContain("restricted incident");
  expect(mail.Text).not.toContain(title);
  expect(mail.HTML).not.toContain(title);
  expect(mail.Text).not.toContain(`/incidents/${id}`);
});
