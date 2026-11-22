// 11. Org-admin pages render; the audit log has the invite and role events;
// delivery settings test-send reaches Mailpit.
import { expect, test } from "./support/fixtures";
import { expectJson, go, need, toast, waitForMail } from "./support/helpers";

test("members, audit log, SLAs, metrics and delivery pages render", async ({ as }) => {
  const { page } = await as("admin");
  const contributor = need("contributor");

  await go(page, "/org-admin/members");
  await expect(page.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
  await expect(page.getByText("Users", { exact: true })).toBeVisible();
  await expect(page.getByText(contributor.email).first()).toBeVisible();

  await go(page, "/org-admin/audit");
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  await expect(page.getByText("org_invite.create").first()).toBeVisible();
  await expect(page.getByText("user.update").first()).toBeVisible();
  await expect(page.getByText("setup.completed").first()).toBeVisible();
  const audit = await expectJson<{ events: { action: string; metadata: unknown; targetLabel: string }[] }>(
    await page.request.get("/api/admin/audit/org", { params: { take: "100" } }),
    200,
  );
  const actions = audit.events.map((e) => e.action);
  expect(actions.filter((a) => a === "org_invite.create")).toHaveLength(2);
  const roleEvents = audit.events.filter((e) => e.action === "user.update" && e.targetLabel === need("reader").email);
  expect(roleEvents.length).toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "Sign-in activity" }).click();
  await expect(page.getByText("Signed in").first()).toBeVisible();

  await go(page, "/org-admin/incident-slas");
  await expect(page.getByRole("heading", { name: "Response SLAs" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Critical" })).toBeVisible();

  await go(page, "/org-admin/incident-metrics");
  await expect(page.getByRole("heading", { name: "Incident metrics" })).toBeVisible();
  await expect(page.getByText("MTTR").first()).toBeVisible();
});

test("delivery settings: providers listed, test-send email reaches Mailpit", async ({ as, request }) => {
  const admin = need("admin");
  const { page } = await as("admin");
  await go(page, "/org-admin/delivery");
  await expect(page.getByRole("heading", { name: "Delivery settings", exact: true })).toBeVisible();

  const row = (name: string | RegExp) => page.getByRole("row").filter({ hasText: name });
  await expect(row("Email (SMTP)")).toContainText("Configured");
  await expect(row(/Webhook \(webhook:8080\)/)).toContainText("Configured");
  await expect(row("SMS (Twilio)")).toContainText("Not configured");
  await expect(row("SMS (Twilio)").getByRole("button", { name: "Send test" })).toBeDisabled();

  const since = new Date();
  await row("Email (SMTP)").getByRole("button", { name: "Send test" }).click();
  await expect(toast(page, /Email \(SMTP\): sent/)).toBeVisible();
  await waitForMail(request, admin.email, { since });

  await row(/Webhook \(webhook:8080\)/).getByRole("button", { name: "Send test" }).click();
  await expect(toast(page, /: sent/).last()).toBeVisible();
});

test("no horizontal overflow at 1280px and 1440px on the main pages", async ({ as }) => {
  const id = need("incidentId");
  const { page } = await as("admin");
  const paths = [
    "/dashboard",
    "/incidents",
    `/incidents/${id}`,
    `/incidents/${id}/escalation`,
    `/incidents/${id}/sitrep`,
    "/escalation-matrix",
    "/settings/notifications",
    "/org-admin/members",
    "/org-admin/delivery",
    "/inbox",
  ];
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of paths) {
      await go(page, path);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), {
          message: `${path} at ${width}px has horizontal overflow (scrollWidth > innerWidth)`,
          timeout: 5_000,
        })
        .toBeLessThanOrEqual(0);
    }
  }
});
