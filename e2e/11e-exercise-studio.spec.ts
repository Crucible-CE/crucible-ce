// 11e. Studio: open the library's branched Strategic TTX template, duplicate
// it, add an inject and a conditional branch to it, save, publish (the checks
// run first), export the file and import it back as a new draft. The export
// uses the crucible-template format.
import { readFileSync } from "node:fs";
import { expect, test } from "./support/fixtures";
import { go, uniq } from "./support/helpers";
import { lastSegment } from "./support/exercise";

const SEED = "lib-strategic-fintech-breach";

type StudioTemplate = { injects: Array<{ nodeId: string; title: string }>; branches: Array<{ toNodeId: string }>; template?: { status?: string }; status?: string };

test("Studio: duplicate, branch, save, publish, export and import", async ({ as }, testInfo) => {
  test.setTimeout(240_000);
  const { page } = await as("contributor");

  await go(page, "/templates");
  await page.locator(`a[href="/studio/${SEED}"]`).first().click();
  await page.waitForURL(new RegExp(`/studio/${SEED}$`), { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Customer data breach at a fintech" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Branched" })).toHaveAttribute("aria-pressed", "true");

  // Work on a copy so the library template stays as shipped.
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await page.waitForURL((u) => /\/studio\/c[a-z0-9]+$/.test(u.pathname), { timeout: 60_000 });
  const copyId = lastSegment(page);
  await expect(page.getByRole("heading", { name: /Customer data breach at a fintech/ })).toBeVisible({ timeout: 60_000 });
  const before = (await (await page.request.get(`/api/studio/templates/${copyId}`)).json()) as StudioTemplate;
  expect(before.branches.length).toBeGreaterThan(0);

  // Add an inject: one active team with a question and expected actions.
  await page.getByRole("button", { name: "Add inject" }).first().click();
  const newTitle = uniq("Regulator calls");
  await page.getByLabel("Title", { exact: true }).fill(newTitle);
  await page.getByLabel("Narrative").fill("The state regulator calls the general counsel and asks for a written timeline by noon.");
  const status = page.getByLabel(/ status$/).first();
  const team = ((await status.getAttribute("aria-label")) ?? "").replace(/ status$/, "");
  await status.selectOption("active");
  await page.getByLabel(/What this team sees/).first().fill("The regulator wants a written timeline by noon.");
  await page.getByRole("button", { name: "Add question" }).first().click();
  await page.getByRole("textbox", { name: `${team} question 1` }).fill("Who writes the timeline and who approves it?");
  await page.getByRole("textbox", { name: `${team} expected actions` }).fill("Names an owner for the timeline\nHas counsel approve it");
  await page.getByText("End node. The run ends after this inject.").click();

  // A conditional branch from the first inject to the new one.
  await page.getByText(before.injects[0].title, { exact: true }).first().click();
  await page.getByRole("tab", { name: "Branches" }).click();
  const sel = page.getByLabel("Add a branch to");
  const label = (await sel.locator("option").allTextContents()).find((t) => t.endsWith(newTitle))!;
  await sel.selectOption({ label });
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const newBranch = page.getByRole("listitem").filter({ has: page.locator("option:checked", { hasText: newTitle }) });
  await newBranch.getByLabel("Condition").selectOption({ label: "Team outcome" });

  // Save, then publish.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Unsaved")).toHaveCount(0, { timeout: 20_000 });
  const saved = (await (await page.request.get(`/api/studio/templates/${copyId}`)).json()) as StudioTemplate;
  const added = saved.injects.find((i) => i.title === newTitle);
  expect(added).toBeTruthy();
  expect(saved.branches.some((b) => b.toNodeId === added!.nodeId)).toBe(true);

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const outcome = await Promise.race([
    page.getByText("Published.", { exact: true }).waitFor({ timeout: 20_000 }).then(() => "published"),
    page.getByText("Fix the errors and warnings before publishing.").waitFor({ timeout: 20_000 }).then(() => "issues"),
  ]);
  if (outcome === "issues") throw new Error(`Publish was blocked by checks:\n${await page.getByRole("tabpanel").innerText()}`);
  const after = (await (await page.request.get(`/api/studio/templates/${copyId}`)).json()) as StudioTemplate;
  expect(after.template?.status ?? after.status).toBe("published");

  // Export, then import the file as a new draft.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const file = testInfo.outputPath("export.json");
  await (await downloadPromise).saveAs(file);
  const exported = JSON.parse(readFileSync(file, "utf8")) as { format: string };
  expect(exported.format).toBe("crucible-template");
  expect(JSON.stringify(exported)).toContain(newTitle);

  await page.locator('input[type="file"]').setInputFiles(file);
  await page.waitForURL((u) => !u.pathname.endsWith(copyId) && /\/(studio|templates)\/c[a-z0-9]+$/.test(u.pathname), { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: /Customer data breach at a fintech/ })).toBeVisible({ timeout: 60_000 });
  const imported = (await (await page.request.get(`/api/studio/templates/${lastSegment(page)}`)).json()) as StudioTemplate;
  expect(imported.injects.some((i) => i.title === newTitle)).toBe(true);
  expect(imported.branches.length).toBe(saved.branches.length);
});
