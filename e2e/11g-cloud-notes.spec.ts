// 11g. Cloud notes and the trial link. A contributor sees a one-line Cloud
// note next to a manual step and can dismiss it (it stays dismissed); a
// reader never gets notes; an administrator can turn them off for everyone.
// The e2e stack runs with CLOUD_TRIAL_URL set, so the Cloud page shows the
// trial button and notes link to the matching card.
import { expect, test } from "./support/fixtures";
import { expectJson, go } from "./support/helpers";
import { CLOUD_TRIAL_URL_E2E } from "./stack";

test("Cloud notes: facilitators only, dismissible, org switch; trial link from CLOUD_TRIAL_URL", async ({ as, guard }) => {
  const { page } = await as("contributor");
  const { page: reader } = await as("reader");
  const { page: admin } = await as("admin");

  // Start from no dismissals.
  await expectJson(await page.request.delete("/api/cloud-notes"), 200);

  // The contributor sees the note on the organization profile, with the trial wording.
  await go(page, "/org-profile");
  const note = page.locator('[data-testid="cloud-note"][data-note="threat-assessment"]');
  await expect(note).toBeVisible({ timeout: 30_000 });
  await expect(note.getByRole("link", { name: "Try free for 1 week" })).toHaveAttribute("href", "/cloud#ai-posture");

  // Dismissed, it stays dismissed.
  await note.getByRole("button", { name: "Dismiss this note" }).click();
  await expect(note).toHaveCount(0);
  await go(page, "/org-profile");
  await expect(page.getByRole("heading", { name: "Organization profile", exact: true })).toBeVisible();
  await expect(note).toHaveCount(0);
  await expectJson(await page.request.delete("/api/cloud-notes"), 200);
  await go(page, "/org-profile");
  await expect(note).toBeVisible({ timeout: 30_000 });

  // A reader gets no notes and cannot dismiss one.
  await go(reader, "/org-profile");
  await expect(reader.getByRole("heading", { name: "Organization profile", exact: true })).toBeVisible();
  await expect(reader.getByTestId("cloud-note")).toHaveCount(0);
  guard.allowHttp(/^403 POST .*\/api\/cloud-notes$/);
  expect((await reader.request.post("/api/cloud-notes", { data: { note: "threat-assessment" } })).status()).toBe(403);

  // The organization switch hides every note.
  await expectJson(await admin.request.patch("/api/settings", { data: { showCloudNotes: false } }), 200);
  await go(page, "/org-profile");
  await expect(page.getByRole("heading", { name: "Organization profile", exact: true })).toBeVisible();
  await expect(page.getByTestId("cloud-note")).toHaveCount(0);
  await expectJson(await admin.request.patch("/api/settings", { data: { showCloudNotes: true } }), 200);

  // The Cloud page: the trial button goes to CLOUD_TRIAL_URL, and the AI cards are there.
  await go(reader, "/cloud");
  const trial = reader.getByTestId("cloud-trial").first();
  await expect(trial).toBeVisible();
  await expect(trial).toHaveText(/Try Crucible Cloud free for 1 week/);
  await expect(trial).toHaveAttribute("href", CLOUD_TRIAL_URL_E2E);
  await expect(reader.getByTestId("cloud-coming-soon")).toHaveCount(0);
  for (const id of ["exo", "ai-posture", "ai-crisis-sim", "ai-playbook", "ai-grading", "ai-aar-draft", "ai-transcript", "ai-strategic-inject"]) {
    await expect(reader.getByTestId(`cloud-card-${id}`)).toBeVisible();
  }
  // Steps Cloud does not have yet read Coming soon even with a trial link.
  for (const id of ["ai-transcript", "ai-strategic-inject"]) {
    await expect(reader.getByTestId(`cloud-card-${id}`).getByTestId("cloud-card-roadmap")).toHaveText("Coming soon");
  }
  await expect(reader.getByTestId("cloud-card-exo").getByTestId("cloud-card-roadmap")).toHaveCount(0);
});
