// 11b. Playbook Exercise built by hand: paste a playbook, build an exercise
// with no modules, write one module with a question and a rubric criterion in
// the editor, publish and launch. A guest player and the reader as scribe post
// entries; the facilitator confirms one and denies the other and grades the
// confirmed entry by hand; ENDEX. Players never receive rubric criteria,
// model answers or grades.
import { expect, test } from "./support/fixtures";
import { go, need, uniq } from "./support/helpers";
import { LeakWatch, addMember, control, controlState, enableGuestJoin, joinAsGuest, lastSegment } from "./support/exercise";

const PLAYBOOK = `# Ransomware Response Playbook

## Declaring an Incident

The incident commander declares a Severity 1 incident when encryption is confirmed on more than one host or on any server. The service desk pages the incident commander within 15 minutes of the first report.

## Containment

The network lead isolates affected hosts from the network before any restore work starts. Backups are disconnected from the production network until the scope is known.
`;

const HIDDEN = /criteria|modelAnswer|"grade"|humanGrade|rubric|expectedActions|sourceExcerpt|rationale/;

type DocState = {
  current?: string | null;
  injects?: Array<{ id: string; status: string; entries?: Array<{ id: string; text: string; status: string; grade?: unknown }> }>;
};

test("Playbook Exercise: build by hand, run with a guest and a scribe, grade by hand", async ({ as, anon }) => {
  test.setTimeout(300_000);
  const reader = need("reader");
  const { page } = await as("contributor");

  // Paste the playbook.
  await go(page, "/documents");
  await page.getByRole("button", { name: "Add document" }).first().click();
  await page.getByRole("tab", { name: "Paste" }).click();
  await page.getByLabel("Title").fill(uniq("Northwind playbook"));
  await page.getByLabel("Text").fill(PLAYBOOK);
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/documents\/c[a-z0-9]+$/, { timeout: 60_000 });

  // Build: no modules yet, one objective.
  await page.getByRole("link", { name: "Build exercise" }).click();
  await page.waitForURL(/\/build$/);
  const title = uniq("E2E playbook");
  await page.getByLabel("Exercise title").fill(title);
  await page.getByRole("radio", { name: /No modules/ }).check();
  await page.getByLabel("Objective 1").fill("Validate who declares a Severity 1 incident and when.");
  await page.getByRole("button", { name: "Write the modules" }).click();
  await page.waitForURL(/\/documents\/templates\/c[a-z0-9]+$/, { timeout: 60_000 });

  // One module, written by hand.
  await page.getByRole("button", { name: "Add module" }).first().click();
  const mod = page.locator("fieldset").filter({ has: page.getByText("Scenario update", { exact: true }) }).first();
  await expect(mod).toBeVisible();
  await mod.getByText("Title", { exact: true }).locator("xpath=following-sibling::input[1]").fill("First report");
  await mod.getByText("Scenario update", { exact: true }).locator("xpath=following-sibling::textarea[1]").fill("At 07:40 the service desk gets a call: two workstations show a ransom note.");
  await mod.getByText("Expected actions", { exact: true }).locator("xpath=following-sibling::textarea[1]").fill("Service desk pages the incident commander within 15 minutes");
  if (!(await mod.getByRole("textbox", { name: "Question 1" }).isVisible())) await mod.getByRole("button", { name: "Add question" }).click();
  await mod.getByRole("textbox", { name: "Question 1" }).fill("Who declares Severity 1, and when?");
  if (!(await mod.getByRole("textbox", { name: "Criterion 1" }).isVisible())) await mod.getByRole("button", { name: "Add criterion" }).click();
  await mod.getByRole("textbox", { name: "Criterion 1" }).fill("Names the incident commander as the one who declares.");

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Published.", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Launch exercise" }).click();
  await page.waitForURL(/\/exercises\/c[a-z0-9]{20,}$/, { timeout: 60_000 });
  const exerciseId = lastSegment(page);
  await expect(page.getByRole("heading", { name: "Details" })).toBeVisible({ timeout: 60_000 });

  // The reader is the scribe; a guest is a player.
  await addMember(page, exerciseId, reader.name, ["scribe"]);
  const code = await enableGuestJoin(page, exerciseId);
  await control(page, exerciseId, "open_lobby");
  const watch = new LeakWatch(HIDDEN);
  const guest = await joinAsGuest(anon, code, "Guest Player", null, watch);
  const { page: scribe } = await as("reader");
  watch.attach(scribe);
  await go(scribe, `/play/${exerciseId}`);

  await page.reload();
  await page.getByRole("button", { name: "Start exercise" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("button", { name: "ENDEX" })).toBeVisible({ timeout: 30_000 });

  // Entries from the player and the scribe.
  const answer = "The incident commander declares Severity 1 once two servers are encrypted.";
  await expect(guest.page.getByText(/Module 1 of 1/)).toBeVisible({ timeout: 30_000 });
  await guest.page.getByLabel("Entry text").fill(answer);
  await guest.page.getByRole("button", { name: "Post entry" }).click();
  await expect(guest.page.getByText(answer)).toBeVisible({ timeout: 15_000 });

  await expect(scribe.getByText(/Module 1 of 1/)).toBeVisible({ timeout: 30_000 });
  await scribe.getByLabel("Speaker role").fill("Network lead");
  await scribe.getByLabel("Entry text").fill("Nobody knew who disconnects the backups.");
  await scribe.getByRole("button", { name: "Post entry" }).click();
  await expect(scribe.getByText("Nobody knew who disconnects the backups.")).toBeVisible({ timeout: 15_000 });

  // The facilitator confirms one, denies the other, and grades the confirmed entry by hand.
  const playerEntry = page.getByRole("listitem").filter({ hasText: answer });
  await playerEntry.getByRole("button", { name: "Confirm" }).click();
  const scribeEntry = page.getByRole("listitem").filter({ hasText: "Nobody knew who disconnects the backups." });
  await scribeEntry.getByRole("button", { name: "Deny" }).click();
  await expect
    .poll(async () => {
      const s = await controlState<DocState>(page, exerciseId);
      const cur = s.injects?.find((i) => i.id === s.current);
      return (cur?.entries ?? []).map((e) => e.status).sort().join(",");
    }, { timeout: 20_000 })
    .toBe("confirmed,denied");

  await playerEntry.getByRole("button", { name: "Grade", exact: true }).click();
  await playerEntry.getByLabel("Score").selectOption("3");
  await playerEntry.getByLabel("Rationale").fill("Names the incident commander and the trigger.");
  await playerEntry.getByRole("button", { name: "Save grade" }).click();
  await expect(page.getByText("Grade saved.").first()).toBeVisible({ timeout: 15_000 });

  // ENDEX.
  await page.getByRole("button", { name: "ENDEX" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "ENDEX" }).click();
  await expect(guest.page.getByRole("heading", { name: "This exercise has ended" })).toBeVisible({ timeout: 30_000 });
  watch.stop();

  expect(watch.responses).toBeGreaterThan(5);
  expect(watch.leaks).toEqual([]);
});
