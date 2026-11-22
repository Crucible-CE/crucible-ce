// Exercise schedule against Postgres (TEST_DATABASE_URL): create with the template
// brief, the ICS feed token (missing, wrong, rotated, off), the advance cron
// and "Create exercise" from an entry.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, ensureTestOrg, hasTestDb, setTestSettings, truncate } from "@/test/exercise-db";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/exercise/auth/session";
import { seedCapabilities } from "@/lib/exercise/seed-capabilities";
import { createCrisisTemplateFixture } from "@/lib/exercise/test-fixture";
import { getExerciseSettings } from "@/lib/exercise/settings";
import { writeAudit } from "@/lib/exercise/audit";
import { GET as feedRoute } from "@/app/api/public/ics/exercises/route";
import { advanceSchedules } from "./advance";
import { disableFeed, FEED_TOKEN_KEY, rotateFeedToken } from "./feed-token";
import { createSchedule, feedIcs, launchFromSchedule, listSchedules, scheduleInputSchema, scheduleIcs, updateSchedule } from "./service";

vi.hoisted(() => {
  process.env.TRUSTED_PROXY_HOPS = "1";
});
vi.mock("@/lib/exercise/auth/session", () => ({ getSessionUser: vi.fn().mockResolvedValue(null) }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

let ip = 0;
function feedRequest(token?: string): Request {
  ip += 1;
  const url = token === undefined ? "http://localhost/api/public/ics/exercises" : `http://localhost/api/public/ics/exercises?token=${encodeURIComponent(token)}`;
  return new Request(url, { headers: { "x-forwarded-for": `198.51.100.${ip % 250}` } });
}

async function makeUser(): Promise<SessionUser> {
  return createTestUser({ email: `s${Math.random().toString(36).slice(2)}@example.test`, name: "Sam Scheduler", role: "facilitator" });
}

const unfold = (s: string) => s.replace(/\r\n /g, "");

describe.skipIf(!hasTestDb)("exercise schedule (integration)", () => {
  beforeAll(async () => {
    await ensureTestOrg();
    await seedCapabilities();
  });
  beforeEach(async () => {
    await truncate("ExerciseSchedule", "Exercise", "ExerciseTemplate", "User", "AuditEvent", "RateLimitBucket");
    await setTestSettings({ timezone: "America/New_York", policy: { cadence: { soc2: 12 } } });
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it("defaults the pre-read to the template brief and lists the next date in the organization zone", async () => {
    const user = await makeUser();
    const templateId = await createCrisisTemplateFixture(db, { createdById: user.id });
    const id = await createSchedule(
      scheduleInputSchema.parse({ title: "Quarterly ransomware", mode: "crisissim", templateId, startDate: "2026-11-03", startTime: "09:00", durationMin: 90, recurrence: "quarterly", frameworkKeys: ["soc2"] }),
      new Date("2026-10-20T12:00:00Z"),
    );
    const row = await db.exerciseSchedule.findUniqueOrThrow({ where: { id } });
    expect(row.briefMd).toContain("ransomware crew");
    expect(row.rrule).toBe("DTSTART;TZID=America/New_York:20261103T090000\nRRULE:FREQ=MONTHLY;INTERVAL=3");
    expect(row.nextAt?.toISOString()).toBe("2026-11-03T14:00:00.000Z"); // 09:00 EST
    const [view] = await listSchedules(new Date("2026-10-20T12:00:00Z"));
    expect(view.upcoming).toEqual(["2026-11-03T14:00:00.000Z", "2027-02-03T14:00:00.000Z", "2027-05-03T13:00:00.000Z"]);
    expect(view.frameworks).toEqual([{ key: "soc2", label: "SOC 2" }]);

    const { ics } = await scheduleIcs(id, new Date("2026-10-20T12:00:00Z"));
    const text = unfold(ics);
    expect(text).toContain("SUMMARY:Quarterly ransomware");
    expect(text).toContain("DTSTART:20261103T140000Z");
    expect(text).toContain("DESCRIPTION:Pre-read\\n\\nA ransomware crew hit the file servers. You lead the response.\\n\\nType: Crisis Sim");
  });

  it("serves the feed only for the current token", async () => {
    await createSchedule(scheduleInputSchema.parse({ title: "Board tabletop, Q4", mode: "strategic", startDate: "2027-01-12", startTime: "15:30", durationMin: 120, briefMd: "Read the; plan, first." }));
    expect((await feedRoute(feedRequest())).status).toBe(404);
    expect((await feedRoute(feedRequest("x".repeat(43)))).status).toBe(404);

    const token = await rotateFeedToken();
    expect(token).toBeTruthy();
    const policy = (await getExerciseSettings())!.policy as Record<string, unknown>;
    expect(policy[FEED_TOKEN_KEY]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(policy)).not.toContain(token!);
    expect(policy.cadence).toEqual({ soc2: 12 }); // other policy keys stay

    const ok = await feedRoute(feedRequest(token!));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    const body = unfold(await ok.text());
    expect(body).toContain("SUMMARY:Board tabletop\\, Q4");
    expect(body).toContain("DESCRIPTION:Pre-read\\n\\nRead the\\; plan\\, first.");
    expect(body).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT1H");

    const next = await rotateFeedToken();
    expect((await feedRoute(feedRequest(token!))).status).toBe(404);
    expect((await feedRoute(feedRequest(next!))).status).toBe(200);

    await disableFeed();
    expect((await feedRoute(feedRequest(next!))).status).toBe(404);
  });

  it("leaves paused entries out of the feed", async () => {
    const id = await createSchedule(scheduleInputSchema.parse({ title: "Paused drill", mode: "strategic", startDate: "2027-02-01", startTime: "10:00", durationMin: 60 }));
    await updateSchedule(id, { isActive: false });
    expect(await feedIcs()).not.toContain("Paused drill");
  });

  it("rolls a recurring entry forward after the slot ends and never twice", async () => {
    const id = await createSchedule(
      scheduleInputSchema.parse({ title: "Monthly drill", mode: "strategic", startDate: "2026-09-30", startTime: "10:00", durationMin: 60, recurrence: "monthly" }),
      new Date("2026-09-01T00:00:00Z"),
    );
    expect((await db.exerciseSchedule.findUniqueOrThrow({ where: { id } })).nextAt?.toISOString()).toBe("2026-09-30T14:00:00.000Z");
    // During the slot nothing moves.
    expect((await advanceSchedules(new Date("2026-09-30T14:30:00Z"))).rolled).toBe(0);
    const now = new Date("2026-10-20T00:00:00Z");
    const [a, b] = await Promise.all([advanceSchedules(now), advanceSchedules(now)]);
    expect(a.rolled + b.rolled).toBe(1);
    expect((await db.exerciseSchedule.findUniqueOrThrow({ where: { id } })).nextAt?.toISOString()).toBe("2026-10-30T14:00:00.000Z");
    expect(await db.exercise.count()).toBe(0);
  });

  it("creates a draft exercise from an entry and adds its teams when the template has none", async () => {
    const user = await makeUser();
    const templateId = await createCrisisTemplateFixture(db, { createdById: user.id });
    const fromTemplate = await createSchedule(scheduleInputSchema.parse({ title: "From template", mode: "crisissim", templateId, startDate: "2027-01-05", startTime: "10:00", durationMin: 60, teams: ["Ignored"] }));
    const { id } = await launchFromSchedule(fromTemplate, user);
    const ex = await db.exercise.findUniqueOrThrow({ where: { id }, include: { teams: { orderBy: { seq: "asc" } } } });
    expect(ex.status).toBe("draft");
    expect(ex.templateId).toBe(templateId);
    expect(ex.teams.map((t) => t.name)).toEqual(["Executive", "Technical"]);

    // Strategic TTX in CE runs from a scripted template only.
    const noStrategicTemplate = await createSchedule(scheduleInputSchema.parse({ title: "Strategic", mode: "strategic", startDate: "2027-01-05", startTime: "10:00", durationMin: 60, teams: ["Legal", "Comms"] }));
    await expect(launchFromSchedule(noStrategicTemplate, user)).rejects.toMatchObject({ status: 400 });

    const noTemplate = await createSchedule(scheduleInputSchema.parse({ title: "No template", mode: "crisissim", startDate: "2027-01-05", startTime: "10:00", durationMin: 60 }));
    await expect(launchFromSchedule(noTemplate, user)).rejects.toMatchObject({ status: 400 });
  });

  it("puts the join link in the calendar entry once a launched exercise takes guests", async () => {
    const prev = process.env.PUBLIC_URL;
    process.env.PUBLIC_URL = "https://ce.example.test";
    try {
      const user = await makeUser();
      const templateId = await createCrisisTemplateFixture(db, { createdById: user.id });
      const sid = await createSchedule(scheduleInputSchema.parse({ title: "With join", mode: "crisissim", templateId, startDate: "2027-01-05", startTime: "10:00", durationMin: 60 }));
      const { id } = await launchFromSchedule(sid, user);
      // The launch route records the entry id on the exercise.created audit row.
      await writeAudit({ actorUserId: user.id, action: "exercise.created", targetType: "Exercise", targetId: id, data: { scheduleId: sid } });
      expect(unfold((await scheduleIcs(sid)).ics)).not.toContain("Join:");
      await db.exercise.update({ where: { id }, data: { guestJoin: true, joinCode: "ABCD2345" } });
      const text = unfold((await scheduleIcs(sid)).ics);
      expect(text).toContain("Join: https://ce.example.test/join/ABCD2345");
      expect(unfold(await feedIcs())).toContain("ABCD2345");
    } finally {
      process.env.PUBLIC_URL = prev;
    }
  });
});
