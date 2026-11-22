// 9. Close: the dialog requires a disposition, lists the blockers, and closes
// with an override reason; open pages are cancelled; the postmortem saves.
import { expect, test } from "./support/fixtures";
import { expectJson, go, need, toast } from "./support/helpers";

type Pages = { pages: { id: string; status: string; cancelledAt: string | null; targetLabel: string }[] };

test("close with blockers, disposition and override; open pages cancelled; postmortem saved", async ({ as, guard }) => {
  const id = need("incidentId");
  const { page } = await as("admin");
  const api = page.request;

  // An open page (awaiting ack) that closing must cancel.
  const paged = await expectJson<{ ok: boolean; pageId: string }>(
    await api.post(`/api/incidents/${id}/page`, { data: { contactId: need("contactId"), note: "Still need you on the bridge" } }),
    200,
  );
  const before = await expectJson<Pages>(await api.get(`/api/incidents/${id}/page`), 200);
  const open = before.pages.filter((p) => p.status === "sent");
  expect(open.map((p) => p.id)).toContain(paged.pageId);

  await go(page, `/incidents/${id}`);
  await page.getByRole("button", { name: "Close incident…" }).click();
  const dialog = page.getByRole("dialog", { name: "Close incident" });
  await expect(dialog).toBeVisible();
  // A disposition is required before anything can be submitted.
  await expect(dialog.getByRole("button", { name: "Close incident" })).toBeDisabled();
  await dialog.locator("#close-disposition").selectOption("true_positive");
  await dialog.locator("#close-note").fill("Credential stuffing; contained by resets.");

  // No postmortem yet: the gate blocks and lists why.
  guard.allowHttp(new RegExp(`^409 PATCH .*/api/incidents/${id}$`));
  await dialog.getByRole("button", { name: "Close incident" }).click();
  await expect(dialog.getByText("Closure is blocked")).toBeVisible();
  await expect(dialog.getByText("No postmortem yet.")).toBeVisible();
  const override = dialog.getByRole("button", { name: "Close with override" });
  await expect(override).toBeDisabled();
  await dialog.locator("#override-reason").fill("Postmortem scheduled for Friday; closing to stop paging.");
  await override.click();
  await expect(toast(page, "Incident closed with override")).toBeVisible();
  await expect(page.getByText("Incident closed", { exact: true }).first()).toBeVisible();

  const inc = await expectJson<{ status: string; closureDisposition: string }>(await api.get(`/api/incidents/${id}`), 200);
  expect(inc.status).toBe("closed");
  expect(inc.closureDisposition).toBe("true_positive");

  // Every page that was open is now cancelled.
  const after = await expectJson<Pages>(await api.get(`/api/incidents/${id}/page`), 200);
  for (const p of open) {
    const now = after.pages.find((x) => x.id === p.id)!;
    expect(now.status, `page ${p.id} (${p.targetLabel})`).toBe("cancelled");
    expect(now.cancelledAt).toBeTruthy();
  }
  await go(page, `/incidents/${id}/escalation`);
  await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();

  // Postmortem.
  await go(page, `/incidents/${id}/postmortem`);
  await expect(page.getByRole("heading", { name: "Postmortem", level: 1 })).toBeVisible();
  const summary = "Credential stuffing against the VPN; 40 accounts reset; MFA rollout follows.";
  await page.getByPlaceholder("What happened and the outcome").fill(summary);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(toast(page, "Saved")).toBeVisible();
  const pm = await expectJson<{ postmortem: { summary: string } | null }>(await api.get(`/api/incidents/${id}/postmortem`), 200);
  expect(pm.postmortem?.summary).toBe(summary);
});
