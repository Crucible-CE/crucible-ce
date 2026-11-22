// 11h. After-action reports and work items for readers. The contributor finds
// the final report from 11d in the list (filters, the PDF export, the link to
// the report) and opens the capability maturity view. The reader sees both
// pages in the nav, no report from an exercise they did not join, and updates
// the work item that names them as the point of contact (status and closure
// evidence), but not someone else's item, and cannot create one.
import { expect, test } from "./support/fixtures";
import { expectJson, go, need, uniq } from "./support/helpers";

type Item = { id: string; correctiveAction: string; status: string; closureEvidence: string | null };

test("after-action reports list, maturity, and a reader's own work items", async ({ as, guard }) => {
  test.setTimeout(180_000);
  const exerciseId = need("crisisExerciseId") as string;
  const title = need("crisisExerciseTitle") as string;
  const reader = need("reader");
  const { page } = await as("contributor");

  // The final report from 11d, with its exports.
  await go(page, "/after-action-reports");
  await expect(page.getByRole("heading", { name: "After-action reports" })).toBeVisible({ timeout: 30_000 });
  const row = page.getByTestId("aar-list").getByRole("row").filter({ hasText: title });
  await expect(row).toBeVisible();
  await expect(row.getByText("Final", { exact: true })).toBeVisible();
  await expect(row.getByText("Dana Reyes")).toBeVisible();
  const pdf = await page.request.get((await row.getByRole("link", { name: "PDF" }).getAttribute("href"))!);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");

  // Filters: status and title keep it, another mode hides it.
  await page.getByLabel("Status").selectOption("final");
  await page.getByLabel("Exercise").fill(title);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Mode").selectOption("strategic");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("No reports match.")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("link", { name: "Clear" }).click();
  await row.getByRole("link", { name: title }).click();
  await expect(page).toHaveURL(new RegExp(`/exercises/${exerciseId}/aar$`));
  await expect(page.getByTestId("aar-status")).toBeVisible({ timeout: 30_000 });

  // Capability maturity.
  await go(page, "/after-action-reports");
  await page.getByRole("link", { name: "Capability maturity" }).click();
  await expect(page.getByRole("heading", { name: "Capability maturity" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("maturity").or(page.getByText("No rated objectives with a capability yet."))).toBeVisible();

  // A work item for the reader, and the one from 11d that is not theirs.
  const action = uniq("Update the call tree");
  await expectJson(await page.request.post("/api/action-items", { data: { afi: "Legal joined late.", correctiveAction: action, poc: reader.name, pocEmail: reader.email } }), 201);
  const all = await expectJson<{ items: Item[] }>(await page.request.get("/api/action-items?status=all"), 200);
  const theirs = all.items.find((i) => i.correctiveAction === "Assign a holding statement owner in the IR plan.");
  expect(theirs).toBeTruthy();

  // The reader: both pages in the nav, no report they did not take part in.
  const { page: r } = await as("reader");
  await go(r, "/after-action-reports");
  const nav = r.getByRole("navigation", { name: "Primary" });
  await expect(nav.getByRole("link", { name: "After-action reports" })).toBeVisible({ timeout: 30_000 });
  await expect(r.getByText("No final reports from your exercises yet.")).toBeVisible();
  await expect(r.getByText(title)).toHaveCount(0);
  await expect(r.getByRole("link", { name: "Capability maturity" })).toHaveCount(0);

  // Their own work item, from the nav.
  await nav.getByRole("link", { name: "Work items" }).click();
  await expect(r.getByRole("heading", { name: "Work items" })).toBeVisible({ timeout: 30_000 });
  const mine = r.getByRole("row").filter({ hasText: action });
  await expect(mine).toBeVisible({ timeout: 15_000 });
  await expect(r.getByText("Assign a holding statement owner in the IR plan.")).toHaveCount(0);
  await expect(r.getByRole("link", { name: "CSV" })).toHaveCount(0);
  await expect(mine.getByRole("button", { name: "Edit" })).toHaveCount(0);

  const status = async () => (await expectJson<{ items: Item[] }>(await r.request.get("/api/action-items?status=all"), 200)).items.find((i) => i.correctiveAction === action);
  await mine.getByLabel("Status").selectOption("in_progress");
  await expect.poll(async () => (await status())?.status, { timeout: 15_000 }).toBe("in_progress");
  await expect(mine.getByLabel("Status").locator("option", { hasText: "Rejected" })).toHaveCount(0);

  await mine.getByRole("button", { name: "Update evidence" }).click();
  const dlg = r.getByRole("dialog");
  await dlg.getByRole("textbox").fill("Draft call tree sent to legal.");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(mine.getByText("Draft call tree sent to legal.")).toBeVisible({ timeout: 15_000 });

  await mine.getByLabel("Status").selectOption("done");
  await dlg.getByRole("textbox").fill("Call tree v4 approved.");
  await dlg.getByRole("button", { name: "Mark done" }).click();
  await expect.poll(async () => (await status())?.status, { timeout: 15_000 }).toBe("done");
  expect((await status())?.closureEvidence).toBe("Call tree v4 approved.");

  // Not someone else's item, no reassigning, no new items.
  guard.allowHttp(/^403 (PATCH|POST) .*\/api\/action-items/);
  expect((await r.request.patch(`/api/action-items/${theirs!.id}`, { data: { status: "in_progress" } })).status()).toBe(403);
  const own = (await status())!;
  expect((await r.request.patch(`/api/action-items/${own.id}`, { data: { pocEmail: "someone@e2e.test" } })).status()).toBe(403);
  expect((await r.request.post("/api/action-items", { data: { afi: "Gap", correctiveAction: "Fix it" } })).status()).toBe(403);
});
