// 10c. Broadcast messaging: readers cannot send (no nav item, a notice, 403);
// the admin broadcasts to the Readers role over in-app and email, sees the
// delivery rows, the reader acknowledges from the email link, and the admin
// sees the acknowledgement.
import { expect, test } from "./support/fixtures";
import { firstLink, go, need, uniq, waitForMail, toast } from "./support/helpers";

test("broadcast: role restricted, delivered in app and by email, acknowledged by link", async ({ as, anon, guard, request }) => {
  const reader = need("reader");

  const { page: r } = await as("reader");
  await go(r, "/dashboard");
  await expect(r.getByRole("link", { name: "Messaging" })).toHaveCount(0);
  await go(r, "/messaging");
  await expect(r.getByText("Contributors and administrators send broadcasts.")).toBeVisible();
  guard.allowHttp(/^403 POST .*\/api\/broadcasts/);
  expect((await r.request.post("/api/broadcasts", { data: { title: "x", message: "x", channels: ["app"], audience: { allMembers: true } } })).status()).toBe(403);

  const { page } = await as("admin");
  await go(page, "/dashboard");
  await page.getByRole("link", { name: "Messaging" }).first().click();
  await expect(page).toHaveURL(/\/messaging$/);
  const compose = page.getByRole("region", { name: "New broadcast" });
  await compose.getByRole("button", { name: "Readers" }).click();
  await expect(compose.getByTestId("broadcast-preview")).toContainText(/^\d+ (person|people):/);
  const title = uniq("E2E bridge open");
  await compose.getByLabel("Title").fill(title);
  await compose.getByLabel("Message").fill("Corporate email may be down. Join the bridge.");
  const since = new Date();
  await compose.getByRole("button", { name: "Send" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Send" }).click();
  await expect(toast(page, "Broadcast sent")).toBeVisible();

  const sent = page.getByRole("region", { name: "Sent broadcasts" });
  const row = sent.getByTestId("broadcast-row").filter({ hasText: title });
  const recipient = row.getByTestId("broadcast-recipient").filter({ hasText: reader.name });
  await expect(recipient).toContainText("app sent");
  await expect(recipient).toContainText("email sent");
  await expect(recipient).toContainText("No");

  // The reader got it in the app and by email; the email link acknowledges once.
  const mail = await waitForMail(request, reader.email, { since, subject: new RegExp(title) });
  const ackUrl = firstLink(mail.Text, "/api/public/page-ack/");
  const { page: link } = await anon();
  await link.goto(ackUrl);
  await expect(link.getByRole("heading", { name: title })).toBeVisible();
  await link.getByRole("button", { name: "Acknowledge" }).click();
  await expect(link.getByRole("heading", { name: "Acknowledged" })).toBeVisible();

  await expect(row).toContainText(/1 of \d+ acknowledged/, { timeout: 15_000 });
  await expect(recipient).toContainText("(link)");
});
