// Action item reminders against Postgres (TEST_DATABASE_URL): only active user
// addresses or allowed domains get mail; the subject is fixed and the body
// is plain text.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDb, setTestSettings, truncate } from "@/test/exercise-db";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/exercise/email";
import { reminderDomains, reminderText, sendDueReminders } from "./reminders";

vi.mock("@/lib/exercise/email", () => ({ emailConfigured: () => true, sendEmail: vi.fn().mockResolvedValue({ sent: true }) }));

const NOW = new Date("2026-10-20T12:00:00Z");
const DUE = new Date("2026-10-22T00:00:00Z");

async function item(pocEmail: string, afi = "Containment was late"): Promise<string> {
  const r = await db.actionItem.create({ data: { afi, correctiveAction: "Write the isolation runbook", pocEmail, dueDate: DUE, status: "open" } });
  return r.id;
}

describe("reminder text", () => {
  it("keeps the subject fixed and user text on one plain line", () => {
    const m = reminderText({ afi: "Line one\r\nBcc: someone@evil.test", correctiveAction: "Act\u0007 now", dueDate: DUE, overdue: false });
    expect(m.subject).toBe("Work item due 2026-10-22");
    expect(m.text).toContain("Area for improvement: Line one Bcc: someone@evil.test");
    expect(m.text).toContain("Corrective action: Act now");
    expect(m.text.split("\n")).toHaveLength(4);
  });

  it("reads reminderDomains from the policy and ignores junk", () => {
    expect([...reminderDomains({ reminderDomains: ["Example.com", "@corp.example", "not a domain", 3] })]).toEqual(["example.com", "corp.example"]);
    expect(reminderDomains({}).size).toBe(0);
    expect(reminderDomains(null).size).toBe(0);
  });
});

describe.skipIf(!hasTestDb)("reminders (integration)", () => {
  beforeEach(async () => {
    await truncate("ActionItem", "User");
    vi.mocked(sendEmail).mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await setTestSettings({ policy: {} });
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it("mails active users and allowed domains, and skips everyone else", async () => {
    await createTestUser({ email: "active@example.test", name: "Active", role: "member" });
    const gone = await createTestUser({ email: "gone@example.test", name: "Gone", role: "member" });
    await db.user.update({ where: { id: gone.id }, data: { isActive: false } });
    const active = await item("Active@Example.test");
    const inactive = await item("gone@example.test");
    const stranger = await item("victim@elsewhere.test");
    const partner = await item("lead@partner.example");

    expect(await sendDueReminders(NOW)).toBe(1);
    expect(vi.mocked(sendEmail).mock.calls.map((c) => c[0].to)).toEqual(["active@example.test"]);
    expect((await db.actionItem.findUniqueOrThrow({ where: { id: active } })).lastRemindedAt).not.toBeNull();
    for (const id of [inactive, stranger, partner]) {
      expect((await db.actionItem.findUniqueOrThrow({ where: { id } })).lastRemindedAt).toBeNull();
    }

    await setTestSettings({ policy: { reminderDomains: ["partner.example"] } });
    vi.mocked(sendEmail).mockClear();
    expect(await sendDueReminders(NOW)).toBe(1);
    expect(vi.mocked(sendEmail).mock.calls.map((c) => c[0].to)).toEqual(["lead@partner.example"]);
    expect(vi.mocked(sendEmail).mock.calls[0][0].subject).toBe("Work item due 2026-10-22");
  });
});
