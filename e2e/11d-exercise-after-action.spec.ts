// 11d. After-action on the Crisis Sim from 11a, all by hand: hotwash items,
// P/S/M/U ratings, attendance, the report draft (factual sections fill in),
// the "How to write the AAR" guide, an executive summary, a strength, the
// findings review (the hotwash item is proposed; an evaluator writes a
// finding and accepts it; the rest are rejected together with one reason),
// an action item for the accepted finding, the after-action meeting record,
// review, the facilitator signature, the sponsor entered by a second
// facilitator, final, and the evidence bundle: PASS with --key, FAIL after one
// character of a file inside it changes.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import JSZip from "jszip";
import { expect, test } from "./support/fixtures";
import { expectJson, go, need } from "./support/helpers";

type Aar = { aar?: { status: string } | null; tracker?: { meeting?: boolean } };

async function aar(page: Page, id: string): Promise<Aar> {
  const r = await page.request.get(`/api/exercises/${id}/aar`);
  return r.ok() ? ((await r.json()) as Aar) : {};
}

function verify(file: string, keyId?: string): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/verify-bundle.ts", ...(keyId ? ["--key", keyId] : []), file], {
      encoding: "utf8",
      cwd: `${__dirname}/..`,
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

/** Click the pencil next to a field, type, save. */
async function editField(scope: ReturnType<Page["locator"]> | Page, label: string, text: string): Promise<void> {
  await scope.getByRole("button", { name: `Edit ${label.toLowerCase()}` }).first().click();
  await scope.getByRole("textbox", { name: label }).fill(text);
  await scope.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(scope.getByText(text).first()).toBeVisible({ timeout: 15_000 });
}

test("after-action: hotwash, ratings, attendance, findings review, hand-written report, sign-off, verified bundle", async ({ as }, testInfo) => {
  test.setTimeout(360_000);
  const exerciseId = need("crisisExerciseId") as string;
  const { page } = await as("contributor");
  const { page: adminPage } = await as("admin");

  // Two-party sign-off: the organization requires a sponsor.
  await expectJson(await adminPage.request.patch("/api/settings", { data: { requireSponsorSignoff: true } }), 200);

  // Hotwash: a strength and an area for improvement.
  await go(page, `/exercises/${exerciseId}/hotwash`);
  await expect(page.getByRole("heading", { name: "Hotwash" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("radio", { name: "Strength" }).click();
  await page.getByLabel("Item").fill("Containment started within minutes.");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Containment started within minutes.")).toBeVisible();
  await page.getByRole("radio", { name: /improvement/i }).click();
  await page.getByLabel("Item").fill("Nobody owned the holding statement.");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Nobody owned the holding statement.")).toBeVisible();

  // Ratings: the first through the screen, the rest through the API.
  await page.getByRole("tab", { name: "Ratings" }).click();
  const firstForm = page.getByRole("radiogroup", { name: "Rating" }).first();
  await firstForm.getByRole("radio", { name: /^P/ }).click();
  await page.getByLabel("Rationale").first().fill("Isolation began within minutes and followed the plan.");
  await page.getByRole("button", { name: "Save rating" }).first().click();
  await expect(page.getByText("Isolation began within minutes and followed the plan.").first()).toBeVisible({ timeout: 15_000 });
  const ratings = await expectJson<{ objectives: Array<{ objectiveId: string }> }>(await page.request.get(`/api/exercises/${exerciseId}/ratings`), 200);
  const letters = ["S", "M", "U"];
  for (const [i, o] of ratings.objectives.slice(1).entries()) {
    await expectJson(await page.request.post(`/api/exercises/${exerciseId}/ratings`, { data: { objectiveId: o.objectiveId, rating: letters[i % 3], rationale: "Rated in the evaluator debrief." } }), [200, 201]);
  }

  // Attendance for everyone on the roster.
  await go(page, `/exercises/${exerciseId}`);
  await page.getByRole("tab", { name: "Roster" }).click();
  const attendance = page.getByTestId("attendance");
  await expect(attendance).toBeVisible({ timeout: 30_000 });
  const selects = attendance.getByLabel(/^Attendance for /);
  await expect(selects.first()).toBeVisible();
  for (let i = 0; i < (await selects.count()); i++) {
    await selects.nth(i).selectOption("attended");
    await expect(selects.nth(i)).toHaveValue("attended", { timeout: 15_000 });
  }

  // The report: factual sections fill in; the evaluator writes the rest.
  await go(page, `/exercises/${exerciseId}/aar`);
  // ENDEX may have started the draft already; otherwise create it.
  const create = page.getByRole("button", { name: "Create draft" });
  await expect(page.getByTestId("aar-tracker").or(create).first()).toBeVisible({ timeout: 30_000 });
  if (await create.isVisible()) await create.click();
  await expect.poll(async () => (await aar(page, exerciseId)).aar?.status, { timeout: 30_000 }).toBe("draft");
  await page.reload();
  await expect(page.getByTestId("aar-tracker")).toBeVisible({ timeout: 30_000 });
  await editField(page, "Executive summary", "The team contained the attack quickly but had no owner for public statements.");
  await page.getByRole("button", { name: "Add strength" }).first().click();
  await expect(page.getByText("New strength").first()).toBeVisible({ timeout: 15_000 });
  await editField(page.getByTestId("strength").first(), "Strength", "Security isolated the affected segments within minutes.");

  // The guide: steps, what blocks finalize, and the prompt with the record.
  await page.getByRole("button", { name: "How to write the AAR" }).click();
  const guide = page.getByRole("dialog");
  await expect(guide.getByTestId("aar-guide-blockers").getByRole("listitem").first()).toBeVisible({ timeout: 15_000 });
  await expect(guide.getByRole("textbox", { name: "Prompt" })).toHaveValue(/Exercise record/, { timeout: 15_000 });
  await expect(guide.getByText("Use your organization's approved AI tool. The prompt includes exercise details.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(guide).toHaveCount(0);

  // Findings: the hotwash item is proposed from the record.
  await page.getByRole("tab", { name: /^Findings/ }).click();
  const findings = page.getByTestId("findings");
  await findings.getByRole("button", { name: "Check the record" }).click();
  const proposed = page.getByTestId("findings-proposed");
  await expect(proposed.getByTestId("finding").filter({ hasText: "Nobody owned the holding statement." })).toBeVisible({ timeout: 15_000 });

  // The evaluator writes a finding, completes it and accepts it.
  await findings.getByRole("button", { name: "Write a finding" }).click();
  const write = page.getByRole("dialog");
  await write.getByLabel("Objective").selectOption({ index: 1 });
  await write.getByLabel("Title").fill("No owner for the holding statement");
  await write.getByLabel("Observation").fill("The reporter's call waited 40 minutes for a statement owner.");
  await write.getByRole("button", { name: "Add", exact: true }).click();
  await expect(write).toHaveCount(0, { timeout: 15_000 });
  const mine = page.getByTestId("finding").filter({ hasText: "No owner for the holding statement" });
  await expect(mine).toHaveAttribute("data-status", "proposed", { timeout: 15_000 });
  await editField(mine, "Analysis", "The plan names no owner for external statements.");
  await editField(mine, "Recommendation", "Name a holding statement owner and a deputy in the plan.");
  await mine.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByTestId("findings-accepted").getByTestId("finding").filter({ hasText: "No owner for the holding statement" })).toBeVisible({ timeout: 15_000 });

  // Every other proposed finding is rejected together, with one reason.
  await findings.getByRole("button", { name: "Select all" }).click();
  await findings.getByRole("button", { name: "Reject selected" }).click();
  const reject = page.getByRole("dialog");
  await reject.getByRole("radio", { name: "Duplicate" }).check();
  await reject.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(reject).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId("findings-proposed").getByTestId("finding")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId("findings-rejected").getByTestId("finding").filter({ hasText: "Nobody owned the holding statement." })).toBeVisible();

  // Create work item, prefilled from the accepted finding.
  const accepted = page.getByTestId("findings-accepted").getByTestId("finding").filter({ hasText: "No owner for the holding statement" });
  await accepted.getByRole("button", { name: "Create work item" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByLabel("Corrective action")).toHaveValue("Name a holding statement owner and a deputy in the plan.");
  await dlg.getByLabel("Corrective action").fill("Assign a holding statement owner in the IR plan.");
  await dlg.getByLabel("Responsible organization").fill("Communications");
  await dlg.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dlg).toHaveCount(0, { timeout: 15_000 });
  await expect(accepted.getByText("Work item created")).toBeVisible({ timeout: 15_000 });

  // The report shows the accepted finding only.
  await page.getByRole("tab", { name: "Report" }).click();
  await expect(page.getByTestId("afi").filter({ hasText: "No owner for the holding statement" })).toBeVisible();
  await expect(page.getByTestId("afi").filter({ hasText: "Nobody owned the holding statement." })).toHaveCount(0);

  // After-action meeting record.
  const aam = page.getByTestId("aam");
  await aam.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Meeting date").fill("2026-03-05T15:00");
  await page.getByLabel("Improvement plan agreed").fill("2026-03-05T16:00");
  await page.getByLabel("Meeting attendees").fill("Exercise director, communications lead, IT lead");
  await page.getByRole("button", { name: "Save meeting record" }).click();
  await expect(aam.getByText("Exercise director, communications lead, IT lead")).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await aar(page, exerciseId)).tracker?.meeting, { timeout: 15_000 }).toBe(true);

  // Review, then the facilitator signs.
  await page.getByRole("button", { name: "Move to review" }).click();
  await expect.poll(async () => (await aar(page, exerciseId)).aar?.status, { timeout: 15_000 }).toBe("review");
  await page.reload();
  await page.getByRole("tab", { name: "Sign-off" }).click();
  await expect(page.getByTestId("approval-statement")).toHaveText("I reviewed this report and approve it and its improvement plan as the record of this exercise.");
  await page.getByLabel("Full name").fill("Dana Reyes");
  await page.getByLabel("Title", { exact: true }).fill("Exercise director");
  await page.getByRole("button", { name: "Sign", exact: true }).click();
  await expect(page.getByText(/^Signed\./).first()).toBeVisible({ timeout: 15_000 });

  // A second facilitator enters the sponsor, who has no account.
  await go(adminPage, `/exercises/${exerciseId}/aar`);
  await adminPage.getByRole("tab", { name: "Sign-off" }).click();
  await adminPage.getByText("Enter for a sponsor with no account").click();
  await adminPage.getByLabel("Full name").fill("Pat Morgan");
  await adminPage.getByLabel("Title", { exact: true }).fill("Chief operating officer");
  await adminPage.getByRole("button", { name: "Sign", exact: true }).click();
  await expect.poll(async () => (await aar(page, exerciseId)).aar?.status, { timeout: 30_000 }).toBe("final");

  // The evidence bundle verifies with the pinned key and fails after a change.
  const signing = await expectJson<{ current: string | null }>(await adminPage.request.get("/api/settings/signing-keys"), 200);
  expect(signing.current).toMatch(/^[a-f0-9]{16}$/);
  await page.reload();
  await page.getByRole("tab", { name: "Sign-off" }).click();
  const dl = page.waitForEvent("download");
  await page.getByRole("link", { name: /Evidence bundle/ }).first().click();
  const file = testInfo.outputPath("bundle.zip");
  await (await dl).saveAs(file);

  const pass = verify(file, signing.current!);
  expect(pass.code, pass.out).toBe(0);
  expect(pass.out).toMatch(/PASS/);

  // Change one character of the roster inside the zip.
  const zip = await JSZip.loadAsync(readFileSync(file));
  const roster = await zip.file("roster.csv")!.async("string");
  zip.file("roster.csv", roster.replace(/a/, "e"));
  const tampered = testInfo.outputPath("bundle-tampered.zip");
  writeFileSync(tampered, await zip.generateAsync({ type: "nodebuffer" }));
  const fail = verify(tampered, signing.current!);
  expect(fail.code, fail.out).toBe(1);
  expect(fail.out).toMatch(/FAIL/);

  // PDF and DOCX of the final report.
  for (const format of ["pdf", "docx"]) {
    const r = await page.request.get(`/api/exercises/${exerciseId}/aar/export?format=${format}`);
    expect(r.status(), format).toBe(200);
    expect((await r.body()).subarray(0, 4).toString("latin1")).toBe(format === "pdf" ? "%PDF" : "PK\u0003\u0004");
  }
});
