// 10d. Incident Playbooks tab: a ransomware incident gets the shipped library
// ransomware playbook suggested from Documents; the contributor attaches it,
// checks off the first step (who and when are shown), adds a step for this
// incident, and turns a step into an incident task. The document is unchanged.
import { expect, test } from "./support/fixtures";
import { expectJson, go, uniq, toast } from "./support/helpers";

test("playbooks tab: suggest, attach, check off, edit, step to task", async ({ as }) => {
  const { page } = await as("contributor");
  const api = page.request;
  const inc = await expectJson<{ id: string }>(
    await api.post("/api/incidents", { data: { title: uniq("E2E PHI warehouse encrypted"), description: "Ransom note on the analytics hosts.", category: "ransomware" } }),
    201,
  );

  await go(page, `/incidents/${inc.id}`);
  await page.getByRole("link", { name: "Playbooks" }).click();
  await expect(page).toHaveURL(new RegExp(`/incidents/${inc.id}/playbooks$`));
  await expect(page.getByTestId("cloud-note").filter({ hasText: "Cloud suggests next actions from your playbooks." })).toBeVisible();

  const suggestions = page.getByTestId("playbook-suggestions");
  const suggestion = suggestions.getByTestId("playbook-suggestion").filter({ hasText: "Ransomware on analytics systems and the PHI warehouse" });
  await expect(suggestion).toContainText("Title matches ransomware");
  await suggestion.getByRole("button", { name: "Attach" }).click();
  await expect(toast(page, "Playbook attached")).toBeVisible();

  const run = page.getByTestId("playbook-run").filter({ hasText: "Ransomware on analytics systems and the PHI warehouse" });
  await expect(run.getByTestId("playbook-progress")).toContainText(/^0 of \d+ done$/);
  const first = run.getByTestId("playbook-step").first();
  await expect(first).toContainText("D1.");
  await first.getByRole("button", { name: /^Mark .* done$/ }).click();
  await expect(run.getByTestId("playbook-progress")).toContainText(/^1 of \d+ done$/);
  await expect(first).toContainText("Done by");

  // Edit the checklist for this incident: add a step to the first section.
  await run.getByRole("button", { name: "Edit checklist" }).click();
  await run.getByRole("button", { name: "Add a step" }).first().click();
  await run.getByLabel("New step").fill("Call the cyber insurer hotline");
  await run.getByRole("button", { name: "Add", exact: true }).click();
  await expect(toast(page, "Step added")).toBeVisible();
  await expect(run.getByText("Call the cyber insurer hotline")).toBeVisible();
  await run.getByRole("button", { name: "Done editing" }).click();

  // Step to task.
  const second = run.getByTestId("playbook-step").nth(1);
  await second.hover();
  await second.getByRole("button", { name: "Make task" }).click();
  await expect(toast(page, "Task created")).toBeVisible();
  await expect(second).toContainText("Task created");
  const tasks = await expectJson<unknown[] | { tasks: { title: string }[] }>(await api.get(`/api/incidents/${inc.id}/tasks`), 200);
  const list = Array.isArray(tasks) ? (tasks as { title: string }[]) : tasks.tasks;
  expect(list.some((t) => /^D2\./.test(t.title))).toBe(true);

  // The library document itself is unchanged: attaching again elsewhere gets the original steps.
  const runs = await expectJson<{ runs: { totalCount: number; doneCount: number }[] }>(await api.get(`/api/incidents/${inc.id}/playbooks`), 200);
  expect(runs.runs[0].doneCount).toBe(1);
});
