// 4. The incident workspace end to end: declare, command roles, participant,
// task (owner + due date/time) with comment and attachment, decision, status
// update, SITREP, handover, corrective action, evidence with access log, MITRE.
import { expect, test } from "./support/fixtures";
import { expectJson, go, need, pickOption, saveRun, uniq, toast } from "./support/helpers";

test.describe.configure({ mode: "serial" });

const title = uniq("E2E credential-stuffing on VPN");

test("declare an incident from the incidents page", async ({ as }) => {
  const { page } = await as("admin");
  await go(page, "/incidents");
  await page.getByRole("button", { name: "Declare incident" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Declare incident" });
  await dialog.getByPlaceholder("Short title").fill(title);
  await dialog.getByPlaceholder(/What happened\?/).fill("Spike of failed VPN logins from a residential proxy pool.");
  await pickOption(dialog.getByRole("combobox").nth(0), "High");
  await pickOption(dialog.getByRole("combobox").nth(1), /unauthorized access/i);
  await dialog.getByRole("button", { name: "Declare incident" }).click();
  await expect(toast(page, "Incident created")).toBeVisible();

  await page.getByText(title).click();
  await expect(page).toHaveURL(/\/incidents\/[a-z0-9]+$/);
  const incidentId = page.url().split("/").pop()!;
  saveRun({ incidentId, incidentTitle: title });

  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Formally Declare" }).click();
  await expect(toast(page, "Incident declared")).toBeVisible();
  const inc = await expectJson<{ declaredAt: string | null; status: string; severity: string }>(
    await page.request.get(`/api/incidents/${incidentId}`),
    200,
  );
  expect(inc.declaredAt).toBeTruthy();
  expect(inc.status).toBe("investigating");
  expect(inc.severity).toBe("high");
});

test("roles, participant, MITRE tag", async ({ as }) => {
  const id = need("incidentId");
  const admin = need("admin");
  const contributor = need("contributor");
  const { page } = await as("admin");
  const api = page.request;

  await expectJson(await api.put(`/api/incidents/${id}/roles`, { data: { role: "incident_commander", userId: admin.id } }), 200);
  await expectJson(await api.put(`/api/incidents/${id}/roles`, { data: { role: "tech_lead", userId: contributor.id } }), 200);
  await expectJson(await api.post(`/api/incidents/${id}/participants`, { data: { userId: contributor.id } }), 201);
  await expectJson(await api.patch(`/api/incidents/${id}`, { data: { mitreJson: ["T1078", "T1110.004"] } }), 200);

  await go(page, `/incidents/${id}`);
  const team = page
    .locator("div")
    .filter({ has: page.getByRole("heading", { name: "Response Team" }) })
    .filter({ hasText: "Tech Lead" })
    .last();
  await expect(team).toContainText(admin.name);
  await expect(team).toContainText(contributor.name);
  await page.getByText("Incident details").click();
  await expect(page.getByText("MITRE ATT&CK")).toBeVisible();
  await expect(page.getByText("T1110.004")).toBeVisible();
});

test("task with owner and due date/time, comment, attachment upload and download", async ({ as }) => {
  const id = need("incidentId");
  const contributor = need("contributor");
  const { page } = await as("admin");
  const due = new Date(Date.now() + 2 * 86_400_000);
  due.setUTCHours(15, 30, 0, 0);
  const task = await expectJson<{ id: string; dueAt: string; assigneeId: string }>(
    await page.request.post(`/api/incidents/${id}/tasks`, {
      data: { title: "Reset VPN credentials for affected users", assigneeId: contributor.id, priority: "high", dueAt: due.toISOString() },
    }),
    201,
  );
  expect(new Date(task.dueAt).toISOString()).toBe(due.toISOString());
  saveRun({ taskId: task.id, taskDueAt: due.toISOString() });

  await go(page, `/incidents/${id}`);
  await expect(page.getByRole("link", { name: /Reset VPN credentials/ })).toBeVisible();

  await go(page, `/incidents/${id}/tasks/${task.id}`);
  await expect(page.getByRole("heading", { name: "Reset VPN credentials for affected users" })).toBeVisible();
  await expect(page.getByLabel("Due date and time")).not.toHaveValue("");

  await page.getByPlaceholder("Add a comment").fill("Started with the 40 accounts in the first wave.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Started with the 40 accounts in the first wave.")).toBeVisible();

  const content = `affected-users\nalice\nbob\n${Date.now()}\n`;
  await page.locator('input[type="file"]').setInputFiles({ name: "affected-users.txt", mimeType: "text/plain", buffer: Buffer.from(content) });
  await expect(page.getByText("affected-users.txt")).toBeVisible();

  const t = await expectJson<{ task: { attachments: { id: string; filename: string }[] } }>(
    await page.request.get(`/api/incidents/${id}/tasks/${task.id}`),
    200,
  );
  const att = t.task.attachments.find((a) => a.filename === "affected-users.txt")!;
  const download = await page.request.get(`/api/incidents/${id}/tasks/${task.id}/attachments/${att.id}`);
  expect(download.status()).toBe(200);
  expect(download.headers()["content-disposition"]).toContain("attachment");
  expect(download.headers()["x-content-type-options"]).toBe("nosniff");
  expect(await download.text()).toBe(content);
});

test("decision, status update, SITREP, handover, corrective action", async ({ as }) => {
  const id = need("incidentId");
  const contributor = need("contributor");
  const { page } = await as("admin");
  const api = page.request;

  const decision = await expectJson<{ id: string }>(
    await api.post(`/api/incidents/${id}/decisions`, { data: { title: "Force a VPN-wide password reset?", context: "Blast radius vs. disruption." } }),
    201,
  );
  await expectJson(
    await api.patch(`/api/incidents/${id}/decisions/${decision.id}`, {
      data: { status: "decided", decision: "Reset all VPN users", rationale: "Credential list is unknown in size." },
    }),
    200,
  );
  await expectJson(
    await api.post(`/api/incidents/${id}/status-updates`, {
      data: { audience: "customer", headline: "VPN sign-in disruption", body: "Some users must reset their VPN password." },
    }),
    200,
  );
  await expectJson(await api.post(`/api/incidents/${id}/handover`, { data: { summary: "Night shift: resets 60% done.", toUserId: contributor.id } }), 201);
  await expectJson(
    await api.post(`/api/incidents/${id}/corrective-actions`, { data: { title: "Enforce phishing-resistant MFA on the VPN", ownerName: "IT" } }),
    200,
  );

  // UI: decision on the Command page, the update on Comms, SITREP published from its page.
  await go(page, `/incidents/${id}`);
  await expect(page.getByText("Force a VPN-wide password reset?", { exact: true })).toBeVisible();
  await go(page, `/incidents/${id}/comms`);
  await expect(page.getByText("VPN sign-in disruption").first()).toBeVisible();

  await go(page, `/incidents/${id}/sitrep`);
  await page.getByRole("button", { name: "New SITREP" }).click();
  await page.getByPlaceholder(/SITREP as of/).fill("SITREP 1: attack contained to the VPN; resets in progress.");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(toast(page, "SITREP published")).toBeVisible();
  await expect(page.getByText("SITREP 1: attack contained to the VPN; resets in progress.").first()).toBeVisible();
  await expect(page.getByText("Night shift: resets 60% done.").first()).toBeVisible();

  await go(page, `/incidents/${id}/postmortem`);
  await expect(page.getByText("Enforce phishing-resistant MFA on the VPN").first()).toBeVisible();

  // The incoming responder accepts the handover in their own session.
  const { page: c } = await as("contributor");
  await go(c, `/incidents/${id}/sitrep`);
  await c.getByRole("button", { name: "Accept handover" }).click();
  await expect(c.getByText(`Accepted by ${contributor.name}`)).toBeVisible();
});

test("evidence upload, download and access log", async ({ as }) => {
  const id = need("incidentId");
  const admin = need("admin");
  const { page } = await as("admin");
  await go(page, `/incidents/${id}/evidence`);
  await page.getByPlaceholder("Description for these files").fill("VPN gateway auth log excerpt");
  const content = `2026-10-14T03:12:09Z auth failure user=alice src=203.0.113.7\n${Date.now()}\n`;
  await page.locator('input[type="file"]').setInputFiles({ name: "vpn-auth.log", mimeType: "text/plain", buffer: Buffer.from(content) });
  await expect(toast(page, "Evidence uploaded & hashed")).toBeVisible();
  await expect(page.getByText("vpn-auth.log")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByTitle("Download").first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("vpn-auth.log");

  const list = await expectJson<{ evidence: { id: string; filename: string; sha256: string }[] }>(
    await page.request.get(`/api/incidents/${id}/evidence`),
    200,
  );
  const ev = list.evidence.find((e) => e.filename === "vpn-auth.log")!;
  const res = await page.request.get(`/api/incidents/${id}/evidence/${ev.id}`);
  expect(await res.text()).toBe(content);
  expect(res.headers()["x-evidence-integrity"]).toBe("verified");
  expect(res.headers()["x-evidence-sha256"]).toBe(ev.sha256);

  const access = await expectJson<{ accesses: { userName: string; action: string }[] }>(
    await page.request.get(`/api/incidents/${id}/evidence/${ev.id}/access`),
    200,
  );
  expect(access.accesses.filter((a) => a.action === "download").length).toBeGreaterThanOrEqual(2);
  expect(access.accesses[0].userName).toBe(admin.name);

  await go(page, `/incidents/${id}/evidence`);
  await page.getByRole("button", { name: /\d+ access/ }).first().click();
  await expect(page.getByText(`${admin.name} · download`).first()).toBeVisible();
});
