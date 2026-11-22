// 10b. Public status page: a contributor creates and publishes the page from
// the Comms tab, posts a public update to it; the public page shows only that
// update. A subscriber confirms by email (double opt-in), gets the next posted
// update by email, and unsubscribes from the link in it.
import { expect, test } from "./support/fixtures";
import { expectJson, firstLink, go, uniq, waitForMail, toast } from "./support/helpers";

test("status page: published updates only, double opt-in, notify, unsubscribe", async ({ as, anon, request }) => {
  const { page } = await as("contributor");
  const api = page.request;
  const internalTitle = uniq("E2E internal title DC02");
  const inc = await expectJson<{ id: string }>(await api.post("/api/incidents", { data: { title: internalTitle, description: "Internal only." } }), 201);

  await go(page, `/incidents/${inc.id}/comms`);
  const card = page.getByTestId("status-page-card");
  await card.getByLabel("Public title").fill("Customer portal disruption");
  await card.getByRole("button", { name: "Create" }).click();
  await expect(toast(page, "Status page created")).toBeVisible();
  const link = await card.getByTestId("status-page-link").inputValue();
  await card.getByRole("button", { name: "Publish" }).click();
  await expect(toast(page, "Status page published")).toBeVisible();
  await expect(card).toContainText("Live");

  // One public update posted to the page, one internal update, one public update not posted.
  const updates = page.getByTestId("status-updates");
  const publish = async (audience: string, headline: string, toPage: boolean) => {
    await updates.getByRole("button", { name: "New" }).click();
    await updates.locator("select").first().selectOption(audience);
    await updates.getByPlaceholder("Headline").fill(headline);
    await updates.getByPlaceholder("Update text").fill(`${headline} body`);
    const box = updates.getByLabel(/Post to the status page/);
    if (await box.count()) await box.setChecked(toPage);
    await updates.getByRole("button", { name: "Publish", exact: true }).click();
    if (audience !== "internal") await page.getByRole("alertdialog").getByRole("button", { name: "Publish" }).click();
    await expect(toast(page, /Update published/)).toBeVisible();
  };
  await publish("public", "We are investigating", true);
  await publish("internal", "Attacker seen on DC02", false);
  await publish("public", "Draft not for the page", false);

  const { page: pub } = await anon();
  await pub.goto(link);
  await expect(pub.getByTestId("status-title")).toHaveText("Customer portal disruption");
  await expect(pub.getByTestId("status-label")).toHaveText("Investigating");
  await expect(pub.getByTestId("status-update")).toHaveCount(1);
  await expect(pub.getByText("We are investigating", { exact: true })).toBeVisible();
  const html = await pub.content();
  expect(html).not.toContain("DC02");
  expect(html).not.toContain("Draft not for the page");
  const json = await pub.request.get(link.replace("/status/", "/api/public/status/"));
  expect(json.headers()["cache-control"]).toContain("max-age=30");

  // Subscribe, confirm from the email (the GET page changes nothing; the button confirms).
  const email = `${uniq("subscriber")}@example.test`;
  const since = new Date();
  await pub.getByLabel("Email").fill(email);
  await pub.getByRole("button", { name: "Subscribe" }).click();
  await expect(pub.getByRole("status")).toHaveText("Check your inbox to confirm.");
  const confirmMail = await waitForMail(request, email, { since, subject: /Confirm status updates/ });
  await pub.goto(firstLink(confirmMail.Text, "/api/public/status-confirm/"));
  await pub.getByRole("button", { name: "Confirm" }).click();
  await expect(pub.getByRole("heading", { name: "Confirmed" })).toBeVisible();

  // Posting the next update emails the subscriber, with an unsubscribe link.
  const since2 = new Date();
  await publish("public", "Service restored", true);
  const update = await waitForMail(request, email, { since: since2, subject: /Status update: Service restored/ });
  expect(update.Text).not.toContain("DC02");
  await pub.goto(firstLink(update.Text, "/api/public/status-unsubscribe/"));
  await pub.getByRole("button", { name: "Unsubscribe" }).click();
  await expect(pub.getByRole("heading", { name: "Unsubscribed" })).toBeVisible();
  await go(page, `/incidents/${inc.id}/comms`);
  await expect(page.getByTestId("status-page-card")).toContainText("0 confirmed subscribers");
});
