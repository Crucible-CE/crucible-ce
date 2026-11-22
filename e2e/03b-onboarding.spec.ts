// 3b. Onboarding: the checklist is derived from real data, so it
// progresses as the work gets done. Administrators: Organization setup (here
// the profile, the matrix, SLAs and a real test page acknowledged from its
// Mailpit link). A reader: Your setup (profile, preferences, and a test page
// acknowledged from the Ops Room). SMS isn't configured in this stack, so the
// phone step is not available. A contributor: the practice steps (a training
// incident that reaches no one, the solo practice sim to ENDEX, a playbook and a
// schedule entry). Readers do not get the practice steps.
import { expect, test } from "./support/fixtures";
import { expectJson, firstLink, go, need, toast, waitForMail, webhookReceived } from "./support/helpers";
import { control, lastSegment } from "./support/exercise";

const step = (page: import("@playwright/test").Page, key: string) => page.getByTestId(`step-${key}`);

test("organization setup progresses as the steps are done", async ({ as, anon, request }) => {
  const admin = need("admin");
  const { page } = await as("admin");
  const api = page.request;

  await go(page, "/onboarding");
  await expect(page.getByRole("heading", { name: "Organization setup" })).toBeVisible();
  // Done by the earlier specs / the environment: team invited (spec 2),
  // email + webhook + signing key (env), a verified contact (spec 3).
  for (const key of ["invite_team", "email_delivery", "extra_channel", "verify_contacts", "signing_key"]) {
    await expect(step(page, key)).toHaveAttribute("data-status", "complete");
  }
  for (const key of ["org_profile", "escalation_matrix", "incident_slas", "test_page"]) {
    await expect(step(page, key)).toHaveAttribute("data-status", "todo");
  }
  await expect(page.getByTestId("progress-org")).toHaveText("5/9 complete");
  await expect(page.getByTestId("detail-escalation_matrix")).toHaveText("1 of 3 contacts · 1 tier");

  // Organization profile + two more contacts + SLAs, through the real APIs.
  const session = await expectJson<{ user: { organizationId: string } }>(await api.get("/api/auth/session"), 200);
  await expectJson(await api.patch(`/api/organizations/${session.user.organizationId}/profile`, { data: { employeeCount: "51-200" } }), 200);
  const added: string[] = [];
  for (const [name, tier] of [
    ["Onboarding Olive", 2],
    ["Onboarding Omar", 3],
  ] as const) {
    const c = await expectJson<{ id: string }>(await api.post("/api/escalation-contacts", { data: { name, role: "technical", tier, email: `${name.split(" ")[1].toLowerCase()}@e2e.test` } }), 201);
    added.push(c.id);
  }
  await expectJson(await api.put("/api/admin/incident-slas", { data: { entries: [{ severity: "critical", milestone: "ack", targetMinutes: 15 }] } }), 200);

  await go(page, "/onboarding");
  for (const key of ["org_profile", "escalation_matrix", "incident_slas"]) {
    await expect(step(page, key)).toHaveAttribute("data-status", "complete");
  }
  await expect(page.getByTestId("progress-org")).toHaveText("8/9 complete");

  // The test page: sent to the admin, acknowledged from the email link like a real page.
  const since = new Date();
  await step(page, "test_page").getByRole("button", { name: "Send me a test page" }).click();
  await expect(toast(page, "Test page sent")).toBeVisible();
  const mail = await waitForMail(request, admin.email, { since, subject: /Test page from Crucible/ });
  const ackUrl = firstLink(mail.Text, "/api/public/page-ack/");
  const { page: ack } = await anon();
  await ack.goto(ackUrl);
  await expect(ack.getByRole("heading", { name: "Test page" })).toBeVisible();
  await ack.getByRole("button", { name: "Acknowledge" }).click();
  await expect(ack.getByRole("heading", { name: "Acknowledged" })).toBeVisible();

  await go(page, "/onboarding");
  await expect(step(page, "test_page")).toHaveAttribute("data-status", "complete");
  await expect(page.getByTestId("progress-org")).toHaveText("9/9 complete");
  await expect(page.getByTestId("complete-org")).toContainText("All steps done.");
  // The admin's own track got the acknowledgement too.
  await page.getByRole("button", { name: /Your setup/ }).click();
  await expect(step(page, "ack_test_page")).toHaveAttribute("data-status", "complete");

  // Derived, not checked off: removing the extra contacts reopens the matrix step.
  for (const id of added) await expectJson(await api.delete(`/api/escalation-contacts/${id}`), 200);
  await go(page, "/onboarding");
  await expect(step(page, "escalation_matrix")).toHaveAttribute("data-status", "todo");
});

test("your setup: a reader completes their profile and acknowledges a test page from the Ops Room", async ({ as }) => {
  const { page } = await as("reader");
  await go(page, "/dashboard");
  // First visit for this member: the welcome modal, then the card.
  const welcome = page.getByRole("dialog", { name: "Welcome to Crucible CE" });
  await expect(welcome).toBeVisible();
  await welcome.getByRole("button", { name: "Start setup" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "Your setup" })).toBeVisible();
  // Readers have no Organization setup track.
  await expect(page.getByRole("button", { name: /Organization setup/ })).toHaveCount(0);
  await expect(step(page, "phone")).toHaveAttribute("data-status", "unavailable");
  await expect(step(page, "phone")).toContainText("SMS is not set up on this server");
  await expect(page.getByTestId("progress-user")).toHaveText("0/4 complete");

  // Profile: name + job title.
  await go(page, "/settings");
  await page.getByLabel("Job title").fill("Communications Officer");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(toast(page, "Profile saved")).toBeVisible();
  await go(page, "/onboarding");
  await expect(step(page, "profile")).toHaveAttribute("data-status", "complete");
  await expect(page.getByTestId("progress-user")).toHaveText("1/4 complete");

  // A test page, acknowledged from the Ops Room.
  await step(page, "ack_test_page").getByRole("button", { name: "Send me a test page" }).click();
  await expect(toast(page, "Test page sent")).toBeVisible();
  await expect(step(page, "ack_test_page")).toContainText("Acknowledge it from the email or the Ops Room");
  await go(page, "/dashboard");
  const row = page.getByTestId("needs-you-test-page");
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Acknowledge" }).click();
  await expect(toast(page, "Test page acknowledged")).toBeVisible();
  await expect(row).toHaveCount(0);
  await expect(page.getByTestId("get-ready-card")).toContainText("2 of 4 done");

  // Hide the card; /onboarding can bring it back.
  await page.getByTestId("get-ready-card").getByRole("button", { name: "Hide" }).click();
  await expect(page.getByTestId("get-ready-card")).toHaveCount(0);
  await go(page, "/onboarding");
  await expect(step(page, "ack_test_page")).toHaveAttribute("data-status", "complete");
  await page.getByRole("button", { name: "Show the Onboarding card in the Ops Room" }).click();
  await expect(page.getByRole("button", { name: "Show the Onboarding card in the Ops Room" })).toHaveCount(0);
  await go(page, "/dashboard");
  await expect(page.getByTestId("get-ready-card")).toBeVisible();
});

test("your setup: a contributor practices with a training incident, the practice sim, a playbook and a schedule", async ({ as, request }) => {
  test.setTimeout(240_000);
  const { page } = await as("contributor");
  const api = page.request;
  const session = await expectJson<{ user: { id: string } }>(await api.get("/api/auth/session"), 200);

  await go(page, "/onboarding");
  await expect(page.getByRole("button", { name: /Organization setup/ })).toHaveCount(0);
  for (const key of ["training_incident", "practice_sim", "ir_playbook", "first_exercise"]) {
    await expect(step(page, key)).toHaveAttribute("data-status", "todo");
  }
  const progress = (await page.getByTestId("progress-user").textContent()) ?? "";
  const m = /^(\d+)\/8 complete$/.exec(progress.trim());
  expect(m, progress).not.toBeNull();
  const before = Number(m![1]);

  // Training incident: started in place, marked, and inert.
  const hooksBefore = (await webhookReceived(request)).length;
  await step(page, "training_incident").getByRole("button", { name: "Start training incident" }).click();
  await page.waitForURL(/\/incidents\/c[a-z0-9]{20,}$/, { timeout: 60_000 });
  const incidentId = page.url().split("/").pop()!;
  await expect(page.getByTestId("training-banner")).toContainText("Training incident");
  await expect(page.getByTestId("training-banner")).toContainText("Nothing here pages, notifies or reaches anyone outside this room.");
  // Idempotent: provisioning again returns the same incident.
  expect(await expectJson<{ incidentId: string; created: boolean }>(await api.post("/api/onboarding/training/provision"), 200)).toEqual({ incidentId, created: false });
  await expectJson(await api.post(`/api/incidents/${incidentId}/tasks`, { data: { title: "Pull the EDR timeline", assigneeId: need("admin").id } }), 201);
  await expectJson(await api.post(`/api/incidents/${incidentId}/status-updates`, { data: { audience: "internal", headline: "Containing", body: "FIN-DB-02 isolated." } }), 200);
  expect((await api.post(`/api/incidents/${incidentId}/page`, { data: { userId: session.user.id } })).status()).toBe(409);
  // Not listed, and nothing went out.
  const list = await expectJson<{ id: string }[]>(await api.get("/api/incidents"), 200);
  expect(list.some((i) => i.id === incidentId)).toBe(false);
  expect((await webhookReceived(request)).length).toBe(hooksBefore);

  await go(page, "/onboarding");
  await expect(step(page, "training_incident")).toHaveAttribute("data-status", "complete");
  await expect(page.getByTestId("detail-training_incident")).toHaveText("Opened · Task or action added · Status update posted");

  // The practice Crisis Sim, solo, through to ENDEX.
  await step(page, "practice_sim").getByRole("button", { name: "Start practice sim" }).click();
  await page.waitForURL(/\/exercises\/c[a-z0-9]{20,}$/, { timeout: 60_000 });
  const exerciseId = lastSegment(page);
  await go(page, "/onboarding");
  await expect(page.getByTestId("detail-practice_sim")).toHaveText("In progress");
  await control(page, exerciseId, "start");
  await control(page, exerciseId, "endex");
  await go(page, "/onboarding");
  await expect(step(page, "practice_sim")).toHaveAttribute("data-status", "complete");

  // IR playbook: the step opens the Library tab; a duplicated library playbook counts.
  await step(page, "ir_playbook").getByRole("link", { name: "Open the library" }).click();
  await expect(page).toHaveURL(/\/documents\?tab=library$/);
  await expect(page.getByRole("tab", { name: "Library" })).toHaveAttribute("aria-selected", "true");
  const library = await expectJson<{ documents: { id: string }[] }>(await api.get("/api/documents?scope=library&kind=playbook"), 200);
  expect(library.documents.length).toBeGreaterThan(0);
  await expectJson(await api.post(`/api/documents/${library.documents[0].id}/duplicate`), 201);

  // First exercise on the schedule.
  const next = new Date(Date.now() + 30 * 86_400_000);
  const date = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
  await expectJson(await api.post("/api/schedule", { data: { title: "Onboarding drill", mode: "crisissim", startDate: date, startTime: "10:00", durationMin: 60 } }), 201);

  await go(page, "/onboarding");
  for (const key of ["ir_playbook", "first_exercise"]) {
    await expect(step(page, key)).toHaveAttribute("data-status", "complete");
  }
  await expect(page.getByTestId("progress-user")).toHaveText(`${before + 4}/8 complete`);

  // Reset: the training incident is gone and the step reopens.
  await step(page, "training_incident").getByRole("button", { name: "Reset" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Reset" }).click();
  await expect(toast(page, "Training incident reset")).toBeVisible();
  await expect(step(page, "training_incident")).toHaveAttribute("data-status", "todo");
  await expect(step(page, "training_incident").getByRole("button", { name: "Start training incident" })).toBeVisible();
  await expect(page.getByTestId("progress-user")).toHaveText(`${before + 3}/8 complete`);
  expect(await expectJson<{ deleted: boolean }>(await api.post("/api/onboarding/training/reset"), 200)).toEqual({ deleted: false });
});
