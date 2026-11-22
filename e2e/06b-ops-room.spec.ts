// 6b. Ops Room "Needs you now": a page sent to the contributor shows up red
// with an inline Acknowledge; acking it there removes it (and records an
// app ack on the page). Their command role with the SLA clock, a task due
// within 24h and an unread @mention are listed too.
import { expect, test } from "./support/fixtures";
import { expectJson, go, need, toast } from "./support/helpers";

test("needs you now: page, role + SLA, due task and mention; acknowledging from the Ops Room", async ({ as }) => {
  const id = need("incidentId");
  const title = need("incidentTitle");
  const contributor = need("contributor");
  const { page: admin } = await as("admin");
  const api = admin.request;

  const due = new Date(Date.now() + 2 * 3_600_000);
  const task = await expectJson<{ id: string }>(
    await api.post(`/api/incidents/${id}/tasks`, { data: { title: "Rotate the VPN signing cert", assigneeId: contributor.id, priority: "high", dueAt: due.toISOString() } }),
    201,
  );
  await expectJson(await api.post(`/api/incidents/${id}/chat`, { data: { message: "@cole can you confirm the cert rotation window?" } }), [200, 201]);
  const paged = await expectJson<{ ok: boolean }>(await api.post(`/api/incidents/${id}/page`, { data: { userId: contributor.id, note: "Need you on the bridge" } }), 200);
  expect(paged.ok).toBe(true);

  const { page } = await as("contributor");
  await go(page, "/dashboard");
  // The contributor's first Ops Room visit: the one-time welcome comes first.
  const welcome = page.getByRole("dialog", { name: "Welcome to Crucible CE" });
  await expect(welcome).toBeVisible();
  await welcome.getByRole("button", { name: "Skip for now" }).click();
  await expect(welcome).toBeHidden();
  const needs = page.getByTestId("needs-you-list");
  const pageRow = page.getByTestId("needs-you-page").filter({ hasText: title });
  await expect(pageRow).toBeVisible();
  await expect(pageRow).toContainText("Paged");
  await expect(needs.getByRole("link", { name: new RegExp(title) }).first()).toBeVisible();
  // Their command role on the incident, with the SLA clock.
  await expect(needs).toContainText("You: Tech Lead");
  await expect(needs.locator("[data-sla-state]").first()).toBeVisible();
  // The task due in 2 hours and the unread mention.
  await expect(page.getByTestId("needs-you-task").filter({ hasText: "Rotate the VPN signing cert" })).toContainText("Due in");
  await expect(needs).toContainText("mentioned you in an incident");
  // Active incidents lists it with the member's role.
  await expect(page.getByTestId("active-incidents")).toContainText(title);
  await expect(page.getByTestId("active-incidents")).toContainText("You: Tech Lead");

  await pageRow.getByRole("button", { name: "Acknowledge" }).click();
  await expect(toast(page, "Page acknowledged")).toBeVisible();
  await expect(page.getByTestId("needs-you-page")).toHaveCount(0);

  const pages = await expectJson<{ pages: { targetUserId: string | null; status: string; acknowledgedVia: string | null }[] }>(
    await api.get(`/api/incidents/${id}/page`),
    200,
  );
  const mine = pages.pages.find((p) => p.targetUserId === contributor.id);
  expect(mine).toMatchObject({ status: "acked", acknowledgedVia: "app" });

  // Keep the incident tidy for the later specs.
  await expectJson(await api.patch(`/api/incidents/${id}/tasks/${task.id}`, { data: { status: "done" } }), 200);
});
