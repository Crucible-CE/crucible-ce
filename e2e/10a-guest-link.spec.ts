// 10a. Incident guest link: the admin invites outside counsel to one incident
// from the Access card; the guest opens the emailed link with no account, sees
// that incident, posts to the chat (the team sees it), and cannot reach any
// other incident or the org. Revoking the link ends access.
import { expect, test } from "./support/fixtures";
import { expectJson, firstLink, go, uniq, waitForMail, toast } from "./support/helpers";

test("guest link: one incident only, chat with the team, revoke ends access", async ({ as, anon, guard, request }) => {
  const { page } = await as("admin");
  const api = page.request;
  const title = uniq("E2E guest incident");
  const other = await expectJson<{ id: string }>(await api.post("/api/incidents", { data: { title: uniq("E2E other incident"), description: "Not for the guest." } }), 201);
  const inc = await expectJson<{ id: string }>(await api.post("/api/incidents", { data: { title, description: "Counsel needs the facts.", severity: "high" } }), 201);

  await go(page, `/incidents/${inc.id}`);
  const card = page.getByTestId("guest-invites");
  await card.getByRole("button", { name: "Invite guest" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite a guest" });
  const guestEmail = `${uniq("counsel")}@law.example`;
  await dialog.getByLabel("Email").fill(guestEmail);
  await dialog.getByLabel("Name").fill("Pat Counsel");
  await dialog.getByLabel("Company").fill("Ressler Kemp LLP");
  const since = new Date();
  await dialog.getByRole("button", { name: "Create link" }).click();
  await expect(toast(page, "Link created and emailed")).toBeVisible();
  const link = await dialog.getByTestId("guest-link").inputValue();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(card).toContainText("Pat Counsel");

  // The emailed link is the same one, and the mail has no incident title.
  const mail = await waitForMail(request, guestEmail, { since, subject: /incident room/ });
  expect(firstLink(mail.Text, "/incident-guest/")).toBe(link);
  expect(mail.Text).not.toContain(title);

  // The guest, with no account.
  const { page: guest } = await anon();
  await guest.goto(link);
  await expect(guest.getByTestId("guest-incident-title")).toHaveText(title);
  await expect(guest.getByText("You are Pat Counsel (guest)")).toBeVisible();
  const msg = `Counsel here ${Date.now()}`;
  await guest.getByPlaceholder("Message the team").fill(msg);
  await guest.getByRole("button", { name: "Send" }).click();
  await expect(guest.getByText(msg)).toBeVisible();

  // The team sees it in the incident chat.
  await go(page, `/incidents/${inc.id}/chat`);
  await expect(page.getByText(msg)).toBeVisible();

  // Nothing else: other incidents, the org and the internal API stay closed.
  guard.allowHttp(/^401 GET .*\/api\/incidents\//);
  guard.allowHttp(/^401 GET .*\/api\/public\/incident-guest\//);
  expect((await guest.request.get(`/api/incidents/${other.id}`)).status()).toBe(401);
  expect((await guest.request.get(`/api/incidents/${inc.id}`)).status()).toBe(401);
  await guest.goto(`/incidents/${inc.id}`);
  await expect(guest).toHaveURL(/\/login/);

  // Revoke: the link stops working.
  await go(page, `/incidents/${inc.id}`);
  await page.getByRole("button", { name: `Revoke the link for ${guestEmail}` }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Revoke" }).click();
  await expect(toast(page, "Link revoked")).toBeVisible();
  await guest.goto(link);
  await expect(guest.getByRole("heading", { name: "This link is not valid" })).toBeVisible();
});
