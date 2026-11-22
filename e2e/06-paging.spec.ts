// 6. Page the escalation contact: per-channel status in the UI, the email in
// Mailpit with an ack link, a correctly signed webhook, then acknowledge
// through the link (confirm page, POST) and prove the link is single-use.
import { createHmac } from "node:crypto";
import { expect, test } from "./support/fixtures";
import { WEBHOOK_URL } from "./stack";
import { BASE_URL, expectJson, firstLink, go, need, saveRun, stack, toast, waitForMail, webhookReceived } from "./support/helpers";

test("page a contact: delivery status, Mailpit email, signed webhook, single-use ack link", async ({ as, anon, guard, request }) => {
  const id = need("incidentId");
  const title = need("incidentTitle");
  const contactName = need("contactName") as string;
  const contactEmail = need("contactEmail");
  await request.delete(`${WEBHOOK_URL}/received`);
  const since = new Date();

  const { page } = await as("admin");
  await go(page, `/incidents/${id}/escalation`);
  await expect(page.getByRole("heading", { name: "Escalation call tree" })).toBeVisible();
  const row = page.locator("li").filter({ hasText: contactName }).filter({ has: page.getByRole("button", { name: "Page", exact: true }) });
  await row.getByRole("button", { name: "Page", exact: true }).click();
  await expect(toast(page, `Paged ${contactName}`)).toBeVisible();

  // Per-channel delivery status.
  const deliveries = page.locator("section").filter({ has: page.getByRole("heading", { name: "Pages & delivery" }) });
  const pageItem = deliveries.locator("ul > li").filter({ hasText: contactName }).first();
  await expect(pageItem).toContainText("Awaiting ack");
  const channel = (provider: string) =>
    pageItem.locator("li").filter({ has: page.locator("span.font-mono", { hasText: new RegExp(`^${provider}$`) }) });
  await expect(channel("smtp")).toContainText("sent");
  await expect(channel("webhook")).toContainText("sent");
  await expect(channel("twilio-sms")).toContainText("skipped: not configured");
  await expect(channel("twilio-voice")).toContainText("skipped: not configured");

  // The email landed in Mailpit, with the incident title and an ack link.
  const mail = await waitForMail(request, contactEmail, { since, subject: /Paged:/ });
  expect(mail.Subject).toBe(`[HIGH] Paged: ${title}`);
  const ackUrl = firstLink(mail.Text, "/api/public/page-ack/");
  expect(ackUrl.startsWith(`${BASE_URL}/api/public/page-ack/`)).toBe(true);

  // The webhook receiver got a payload whose signature verifies (checked by
  // the receiver, and again here against the documented scheme).
  let hook: Awaited<ReturnType<typeof webhookReceived>>[number] | undefined;
  await expect
    .poll(async () => {
      hook = (await webhookReceived(request)).find((h) => h.body?.type === "crucible.page");
      return !!hook;
    })
    .toBe(true);
  expect(hook!.valid).toBe(true);
  const [, t, v1] = /t=(\d+),v1=([0-9a-f]+)/.exec(hook!.signature ?? "") ?? [];
  expect(createHmac("sha256", stack().webhookSecret).update(`${t}.${hook!.raw}`).digest("hex")).toBe(v1);
  expect((hook!.body!.incident as { title: string }).title).toBe(title);
  expect(hook!.body!.ackUrl).toBeTruthy();

  // Acknowledge from the email link, as the paged person (no session).
  const { page: ack } = await anon();
  await ack.goto(ackUrl);
  await expect(ack.getByRole("heading", { name: title })).toBeVisible();
  await expect(ack.getByText("you have been paged to this incident")).toBeVisible();
  await ack.getByRole("button", { name: "Acknowledge" }).click();
  await expect(ack.getByRole("heading", { name: "Acknowledged" })).toBeVisible();
  await expect(ack.getByText("has stopped")).toBeVisible();

  // The incident shows the page as acknowledged.
  await page.getByRole("button", { name: "Refresh pages" }).click();
  await expect(pageItem).toContainText("Acknowledged via link");

  // Reuse: the link is single-use.
  await ack.goto(ackUrl);
  await expect(ack.getByText("This page has already been acknowledged.")).toBeVisible();
  const reuse = await request.post(ackUrl);
  expect(reuse.status()).toBe(409);
  expect(await reuse.text()).toContain("This page has already been acknowledged.");
  guard.allowHttp(/^409 POST .*\/api\/public\/page-ack\//);

  // An ack event went to the webhook as well.
  await expect.poll(async () => (await webhookReceived(request)).some((h) => h.body?.type === "crucible.ack" && h.valid)).toBe(true);
  saveRun({ ackUrl });
});

test("paging a target no addressed channel can reach returns a warning and alerts the IC/admins", async ({ as }) => {
  const id = need("incidentId");
  const { page } = await as("admin");
  const api = page.request;
  // A contact with only an UNVERIFIED phone (and no Twilio): email, SMS and
  // voice are all skipped.
  const c = await expectJson<{ id: string }>(
    await api.post("/api/escalation-contacts", { data: { name: "Unreachable Ursula", role: "vendor", phone: "+15551230077" } }),
    201,
  );
  const res = await expectJson<{ ok: boolean; warning: string | null; deliveries: { channel: string; status: string; error: string | null }[] }>(
    await api.post(`/api/incidents/${id}/page`, { data: { contactId: c.id } }),
    200,
  );
  expect(res.ok).toBe(true);
  expect(res.warning).toContain("No email, SMS or voice channel could reach Unreachable Ursula");
  // No Twilio in this stack: SMS/voice are "not configured" (checked first);
  // no email on file. Every addressed channel skipped -> the warning.
  for (const ch of ["email", "sms", "voice"]) expect(res.deliveries.find((d) => d.channel === ch)?.status).toBe("skipped");
  const inbox = await expectJson<{ notifications: { type: string; title: string }[] }>(await api.get("/api/notifications?limit=50"), 200);
  expect(inbox.notifications.some((n) => n.type === "page_delivery_unreachable")).toBe(true);
  // Keep the matrix tidy for the later specs.
  await expectJson(await api.delete(`/api/escalation-contacts/${c.id}`), 200);
});
