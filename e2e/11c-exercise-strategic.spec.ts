// 11c. Scripted Strategic TTX: the library's branched fintech scenario with
// two guest teams. Every active team answers and the inject closes on
// all_teams. With hold after close on, the evaluator grades both answers by
// hand, rating Communications ineffective, and the branch to "The story
// breaks" follows. Then a contingency inject goes to Communications only.
// Players never see expected actions, grading notes or another team's brief.
import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { go, uniq } from "./support/helpers";
import { LeakWatch, control, controlState, enableGuestJoin, joinAsGuest, lastSegment } from "./support/exercise";

const HIDDEN = /expectedActions|gradingNotes|mitreTags|aiDetail|humanGrade|"rationale"/;

type Variant = { team: string; narrativeMd: string };
type StInject = {
  id: string;
  title: string;
  status: string;
  variants?: Variant[];
  control?: { answers?: Array<{ teamId: string; responseId: string }> };
};
type StState = { current?: string | null; teams: Array<{ id: string; name: string }>; injects: StInject[]; roster: Array<{ id: string; isGuest: boolean }> };

async function current(page: Page, id: string): Promise<StInject | null> {
  const s = await controlState<StState>(page, id);
  return s.injects.find((i) => i.id === s.current) ?? null;
}

async function answer(guest: Page, injectTitle: string, text: string): Promise<void> {
  await expect(guest.getByRole("heading", { name: injectTitle, exact: true }).first()).toBeVisible({ timeout: 30_000 });
  const box = guest.getByLabel("Team answer");
  const standby = guest.getByText("Your team is on standby");
  await expect(box.or(standby).first()).toBeVisible({ timeout: 30_000 });
  if (!(await box.isVisible())) return;
  await box.fill(text);
  await guest.getByRole("button", { name: "Submit answer" }).click();
  const id = lastSegment(guest);
  await expect
    .poll(async () => {
      const s = (await (await guest.request.get(`/api/play/${id}/state`)).json()) as { injects?: Array<{ myAnswer?: { text?: string } | null }> };
      return (s.injects ?? []).some((i) => i.myAnswer?.text === text);
    }, { timeout: 15_000 })
    .toBe(true);
}

test("Strategic TTX: scripted branched run, hand grading, branch and contingency", async ({ as, anon }) => {
  test.setTimeout(300_000);
  const { page } = await as("contributor");

  // The Studio's Launch link preselects the template.
  await go(page, "/strategic/new?templateId=lib-strategic-fintech-breach");
  await expect(page.locator(`[role="radiogroup"][aria-label="Template"] [aria-checked="true"]`)).toContainText("Customer data breach at a fintech", { timeout: 30_000 });
  for (let i = 0; i < 5; i++) {
    const next = page.getByRole("button", { name: "Next", exact: true });
    if (!(await next.isVisible())) break;
    await next.click();
  }
  await page.getByRole("button", { name: "Create exercise" }).click();
  await page.waitForURL(/\/exercises\/c[a-z0-9]{20,}$/, { timeout: 60_000 });
  const exerciseId = lastSegment(page);
  await expect(page.getByRole("heading", { name: "Details" })).toBeVisible({ timeout: 60_000 });

  // Two teams, close when every team has answered.
  const s0 = await controlState<StState>(page, exerciseId);
  const teams = s0.teams.filter((t) => ["Communications", "IT and Security"].includes(t.name)).map((t) => ({ id: t.id, name: t.name }));
  expect(teams).toHaveLength(2);
  const patched = await page.request.patch(`/api/exercises/${exerciseId}`, { data: { title: uniq("E2E strategic"), teams, advancePolicy: "all_teams" } });
  expect(patched.ok(), await patched.text()).toBe(true);
  const code = await enableGuestJoin(page, exerciseId);
  await control(page, exerciseId, "open_lobby");

  const watch = new LeakWatch(HIDDEN);
  const comms = await joinAsGuest(anon, code, "Casey Comms", "Communications", watch);
  const sec = await joinAsGuest(anon, code, "Sam Security", "IT and Security", watch);
  const roster = (await controlState<StState>(page, exerciseId)).roster.filter((p) => p.isGuest);
  for (const p of roster) {
    const r = await page.request.patch(`/api/exercises/${exerciseId}/participants`, { data: { participantId: p.id, isDecisionMaker: true } });
    expect(r.ok(), await r.text()).toBe(true);
  }

  await page.reload();
  await page.getByRole("button", { name: "Start exercise" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("button", { name: "ENDEX" })).toBeVisible({ timeout: 30_000 });

  // First update: both teams answer; all_teams closes it.
  const f1 = (await current(page, exerciseId))!;
  expect(f1.title).toMatch(/Unusual export/);
  const othersBrief = (f1.variants ?? []).find((v) => v.team === "IT and Security")?.narrativeMd;
  await answer(comms.page, f1.title, "Communications drafts a holding statement and routes it through legal before release.");
  await answer(sec.page, f1.title, "Security revokes the exposed keys, preserves the warehouse logs and scopes the export.");
  await expect.poll(async () => (await controlState<StState>(page, exerciseId)).injects.find((i) => i.id === f1.id)?.status, { timeout: 30_000 }).toBe("closed");
  if (othersBrief) {
    const body = await (await comms.page.request.get(`/api/play/${exerciseId}/state`)).text();
    expect(body.includes(othersBrief.slice(0, 60))).toBe(false);
  }

  // Second update (the Otherwise branch), held after close for grading.
  await expect.poll(async () => (await current(page, exerciseId))?.title ?? "", { timeout: 30_000 }).toMatch(/Scope confirmed/);
  const f2 = (await current(page, exerciseId))!;
  await control(page, exerciseId, "config", { config: { holdAfterClose: true } });
  await answer(comms.page, f2.title, "Communications waits for more facts before saying anything to customers.");
  await answer(sec.page, f2.title, "Security confirms the scope with the forensic firm and rotates every key in the repository.");
  await expect.poll(async () => (await controlState<StState>(page, exerciseId)).injects.find((i) => i.id === f2.id)?.status, { timeout: 30_000 }).toBe("closed");
  // Held: nothing new opens on its own.
  await page.waitForTimeout(1500);
  expect((await current(page, exerciseId))?.id).toBe(f2.id);

  // The evaluator grades both answers by hand.
  const st = await controlState<StState>(page, exerciseId);
  const commsTeam = st.teams.find((t) => t.name === "Communications")!;
  const answers = st.injects.find((i) => i.id === f2.id)?.control?.answers ?? [];
  expect(answers).toHaveLength(2);
  for (const a of answers) {
    const bad = a.teamId === commsTeam.id;
    const r = await page.request.post(`/api/strategic/${exerciseId}/grades`, {
      data: { responseId: a.responseId, score: bad ? 1 : 3, rating: bad ? "ineffective" : "effective", rationale: bad ? "No customer message for six hours." : "Scoped and contained." },
    });
    expect(r.ok(), await r.text()).toBe(true);
  }

  // Advance: the branch follows the Communications outcome.
  await control(page, exerciseId, "advance");
  await expect.poll(async () => (await current(page, exerciseId))?.title ?? "", { timeout: 30_000 }).toMatch(/story breaks/);
  const f3 = (await current(page, exerciseId))!;
  await answer(comms.page, f3.title, "Communications publishes a short statement and opens a customer help line.");
  await answer(sec.page, f3.title, "Security briefs communications on what is confirmed and what is not.");
  await expect.poll(async () => (await controlState<StState>(page, exerciseId)).injects.find((i) => i.id === f3.id)?.status, { timeout: 30_000 }).toBe("closed");

  // A contingency inject to Communications only, while the run is held.
  const cont = await page.request.post(`/api/strategic/${exerciseId}/contingency`, {
    data: {
      title: "A customer calls the CEO",
      narrativeMd: "A large customer calls the CEO directly and threatens to move its accounts today.",
      targetTeamIds: [commsTeam.id],
      questions: ["What do you tell the customer and who calls them back?"],
    },
  });
  expect(cont.ok(), await cont.text()).toBe(true);
  await expect(comms.page.getByText("A customer calls the CEO").first()).toBeVisible({ timeout: 30_000 });
  await expect(sec.page.getByText("A customer calls the CEO")).toHaveCount(0);

  // ENDEX.
  await go(page, `/exercises/${exerciseId}`);
  await page.getByRole("button", { name: "ENDEX" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "ENDEX" }).click();
  await expect(comms.page.getByRole("heading", { name: "This exercise has ended" })).toBeVisible({ timeout: 30_000 });
  watch.stop();

  expect(watch.responses).toBeGreaterThan(5);
  expect(watch.leaks).toEqual([]);
});
