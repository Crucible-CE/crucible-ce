// 11a. Crisis Sim from the library with guests: the contributor launches the
// seeded "Ransomware decision sim", turns on join by code and opens the lobby.
// Two guests join with the invite code; one is the team's decision maker.
// Votes, hold after close, Next inject, a regulatory clock, ENDEX and the
// debrief. No hidden scoring field reaches a guest before ENDEX. The admin
// joins as a controller (the sponsor signature in 11d). The ended exercise
// is used by the after-action spec (11d).
import { expect, test } from "./support/fixtures";
import { go, need, saveRun, uniq } from "./support/helpers";
import { LeakWatch, addMember, controlState, joinAsGuest, lastSegment } from "./support/exercise";

const HIDDEN = /quality|clockEffects|followUps|rationale|expectedActions|deliverableCriteria|cumulative/;

type CsState = {
  current?: string | null;
  injects?: Array<{ id: string; seq: number; status: string; progress?: { voted: number } }>;
  clocks?: Array<{ key: string; triggeredAt: string | null; deadlineAt: string | null }>;
};

test("Crisis Sim: guests by invite code, decision maker, hold, clock, ENDEX, debrief", async ({ as, anon, guard }) => {
  test.setTimeout(300_000);
  const { page } = await as("contributor");

  // Launch from the library template.
  await go(page, "/exercises/new");
  await page.getByRole("button", { name: /Crisis Sim/ }).click();
  await page.getByRole("radio", { name: /Ransomware decision sim/ }).click();
  const title = uniq("E2E crisis");
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Create exercise" }).click();
  await page.waitForURL(/\/exercises\/c[a-z0-9]{20,}$/, { timeout: 60_000 });
  const exerciseId = lastSegment(page);
  await expect(page.getByRole("heading", { name: "Details" })).toBeVisible({ timeout: 60_000 });

  // Objectives come from the template.
  await expect(page.getByRole("textbox", { name: "Objective 1", exact: true })).toHaveValue(/Contain the attack/);

  // Scenario start and facilitator-driven advance.
  await page.getByLabel(/Scenario start/).fill("2026-03-02T05:40");
  await page.getByLabel("Next inject").selectOption("facilitator");
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(page.getByText("Saved.").first()).toBeVisible();

  // A second facilitator for the after-action sign-off.
  await addMember(page, exerciseId, need("admin").name, ["controller"]);

  // Join by code, lobby open.
  await page.getByLabel("Join by code").click();
  await expect(page.getByTestId("join-code")).toBeVisible();
  const code = (await page.getByTestId("join-code").textContent())!.trim();
  await page.getByRole("button", { name: "Open lobby" }).click();
  await expect(page.getByRole("button", { name: "Close lobby" })).toBeVisible();

  // Two guests on two teams, watching everything they receive.
  const watch = new LeakWatch(HIDDEN);
  const g1 = await joinAsGuest(anon, code, "Guest Exec", "Executive", watch);
  const g2 = await joinAsGuest(anon, code, "Guest Sec", "Security", watch);
  expect(g1.exerciseId).toBe(exerciseId);
  await expect(g1.page.getByRole("heading", { name: "Waiting for the facilitator to start" })).toBeVisible({ timeout: 30_000 });

  // Guests get the Situation Manual through the play API, never the control documents.
  const sm = await g1.page.request.get(`/api/play/${exerciseId}/exports/situation-manual`);
  expect(sm.status()).toBe(200);
  expect((await sm.body()).subarray(0, 5).toString()).toBe("%PDF-");
  guard.allowHttp(new RegExp(`^401 GET .*/api/exercises/${exerciseId}/exports/ce-handbook$`));
  expect((await g1.page.request.get(`/api/exercises/${exerciseId}/exports/ce-handbook`)).status()).toBe(401);
  for (const kind of ["situation-manual", "ce-handbook"]) {
    const r = await page.request.get(`/api/exercises/${exerciseId}/exports/${kind}`);
    expect(r.status(), kind).toBe(200);
    expect((await r.body()).subarray(0, 5).toString(), kind).toBe("%PDF-");
  }

  // Make Guest Exec the Executive decision maker.
  await page.reload();
  const dm = page.getByLabel("Decision maker Guest Exec");
  await expect(dm).toBeVisible({ timeout: 30_000 });
  await dm.click();
  await expect(dm).toBeChecked();

  // Start.
  await page.getByRole("button", { name: "Start exercise" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("button", { name: "ENDEX" })).toBeVisible({ timeout: 30_000 });

  // The insurer notice clock starts with the first inject.
  await expect
    .poll(async () => (await controlState<CsState>(page, exerciseId)).clocks?.find((c) => c.key === "insurer_notice")?.triggeredAt ?? null, { timeout: 20_000 })
    .not.toBeNull();

  // Votes. The decision maker's choice is the team decision.
  for (const g of [g1, g2]) await expect(g.page.getByTestId("update-progress")).toHaveText("Update 1 of 5", { timeout: 30_000 });
  await g1.page.getByRole("radio", { name: /Activate the response plan, make the CISO incident commander/ }).click();
  await g1.page.getByRole("button", { name: "Submit decision" }).click();
  await g2.page.getByRole("radio", { name: /Isolate the affected segments and disable the admin account now/ }).click();
  await g2.page.getByRole("button", { name: "Submit vote" }).click();
  await expect
    .poll(async () => {
      const s = await controlState<CsState>(page, exerciseId);
      return s.injects?.find((i) => i.id === s.current)?.progress?.voted ?? -1;
    }, { timeout: 30_000 })
    .toBe(2);

  // Hold after close, then close: the inject stays on screen until Next inject.
  const hold = page.getByRole("switch", { name: "Hold after close" }).or(page.getByLabel("Hold after close"));
  await hold.first().click();
  await expect(hold.first()).toBeChecked();
  await page.getByRole("button", { name: "Close inject" }).click();
  await expect(page.getByText("Closed", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  const held = await controlState<CsState>(page, exerciseId);
  expect(held.injects?.filter((i) => i.status === "open").length ?? 0).toBe(0);
  await expect(g1.page.getByTestId("update-progress")).toHaveText("Update 1 of 5");

  await page.getByRole("button", { name: "Next inject" }).click();
  await expect(g1.page.getByTestId("update-progress")).toHaveText("Update 2 of 5", { timeout: 30_000 });
  // Update 2 goes to Executive, Legal and Communications only.
  await expect(g2.page.getByText("This update is for other teams.")).toBeVisible({ timeout: 30_000 });
  await g1.page.getByRole("radio").first().click();
  await g1.page.getByRole("button", { name: "Submit decision" }).click();
  await expect
    .poll(async () => {
      const s = await controlState<CsState>(page, exerciseId);
      return s.injects?.find((i) => i.id === s.current)?.progress?.voted ?? -1;
    }, { timeout: 30_000 })
    .toBe(1);

  // ENDEX. The debrief reveals rationales to players, so the watch stops here.
  watch.stop();
  await page.getByRole("button", { name: "ENDEX" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "ENDEX" }).click();
  await expect(page.getByText("Run time")).toBeVisible({ timeout: 30_000 });
  await expect(g1.page.getByRole("heading", { name: "This exercise has ended" })).toBeVisible({ timeout: 30_000 });
  // Debrief for players and control.
  await expect(g1.page.getByRole("heading", { name: /Debrief/i }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: /Debrief/i }).first()).toBeVisible({ timeout: 15_000 });

  expect(watch.frames).toBeGreaterThan(0);
  expect(watch.responses).toBeGreaterThan(5);
  expect(watch.leaks).toEqual([]);

  saveRun({ crisisExerciseId: exerciseId, crisisExerciseTitle: title });
});
