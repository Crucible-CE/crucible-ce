// @vitest-environment node
// POST /api/exercises/{id}/invites: driver only, email off, validation, and
// that addresses reach neither the audit row nor the log.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  db: {
    exercise: { findUnique: vi.fn() },
  },
  settings: vi.fn(),
  requireAccess: vi.fn(),
  emailConfigured: vi.fn(),
  sendEmail: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/exercise/settings", () => ({ getExerciseSettings: h.settings }));
vi.mock("@/lib/exercise/audit", () => ({ audit: h.audit }));
// CE limits run on Redis. Here an in-memory counter stands in for it.
const hits = new Map<string, number>();
vi.mock("@/lib/exercise/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/exercise/rate-limit")>()),
  checkRateLimit: vi.fn(async (o: { namespace: string; identifier: string; max: number }) => {
    const k = `${o.namespace}:${o.identifier}`;
    const n = (hits.get(k) ?? 0) + 1;
    hits.set(k, n);
    return { allowed: n <= o.max, count: n, retryAfter: n <= o.max ? 0 : 60, failOpen: false };
  }),
}));
vi.mock("@/lib/exercise/email", () => ({ emailConfigured: h.emailConfigured, sendEmail: h.sendEmail }));
vi.mock("@/lib/exercise/access", () => ({
  requestPrincipal: vi.fn(async () => ({ kind: "user", userId: "u1" })),
  requireAccess: h.requireAccess,
  actorOf: vi.fn(() => ({ userId: "u1", participantId: "p1" })),
}));

import { ServiceError } from "@/lib/exercise/errors";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ id: "ex1" }) };

function req(body: unknown) {
  const text = JSON.stringify(body);
  return new Request("http://localhost:3110/api/exercises/ex1/invites", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) },
    body: text,
  });
}

const EXERCISE = {
  id: "ex1",
  title: "Ransomware drill",
  status: "lobby",
  guestJoin: true,
  joinCode: "ABCD2345",
  plan: { schemaVersion: 1, startsAt: "2026-11-01T14:00:00.000Z" },
  scenarioStartAt: null,
  timeboxMin: 90,
  templateId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  hits.clear();
  process.env.PUBLIC_URL = "https://ttx.example.com";
  h.requireAccess.mockResolvedValue({ participant: { id: "p1" }, viewer: { isDriver: true } });
  h.emailConfigured.mockReturnValue(true);
  h.sendEmail.mockResolvedValue({ sent: true });
  h.db.exercise.findUnique.mockResolvedValue(EXERCISE);
  h.settings.mockResolvedValue({ timezone: "America/New_York" });
});

describe("POST /api/exercises/{id}/invites", () => {
  it("is driver only", async () => {
    h.requireAccess.mockRejectedValue(new ServiceError(403, "Only a facilitator or controller can do this."));
    const res = await POST(req({ emails: "a@example.com" }), ctx);
    expect(res.status).toBe(403);
    expect(h.requireAccess).toHaveBeenCalledWith("ex1", expect.anything(), "driver");
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("says email is off and sends nothing without an email transport", async () => {
    h.emailConfigured.mockReturnValue(false);
    const res = await POST(req({ emails: "a@example.com" }), ctx);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Email is not set up on this server.", emailEnabled: false });
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("refuses a bad address before sending", async () => {
    const res = await POST(req({ emails: "a@example.com, nope" }), ctx);
    expect(res.status).toBe(400);
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("needs join by code", async () => {
    h.db.exercise.findUnique.mockResolvedValue({ ...EXERCISE, guestJoin: false });
    const res = await POST(req({ emails: "a@example.com" }), ctx);
    expect(res.status).toBe(409);
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("sends one email per address and audits counts only", async () => {
    h.sendEmail.mockImplementation(async ({ to }: { to: string }) => {
      if (to === "c@example.com") throw Object.assign(new Error("550 c@example.com rejected"), { responseCode: 550 });
      return { sent: true };
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await POST(req({ emails: "a@example.com\nb@example.com, A@example.com; c@example.com", note: "Bring a laptop." }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 2, failed: 1 });
    expect(h.sendEmail).toHaveBeenCalledTimes(3);
    const first = h.sendEmail.mock.calls[0]![0] as { to: string; subject: string; text: string };
    expect(first.subject).toBe("Invitation: Ransomware drill");
    expect(first.text).toContain("Join: https://ttx.example.com/join/ABCD2345");
    expect(first.text).toContain("Code: ABCD2345");
    expect(first.text).toContain("Start: 2026-11-01 09:00 EST");
    expect(first.text).toContain("Bring a laptop.");
    expect(h.audit).toHaveBeenCalledTimes(1);
    const row = h.audit.mock.calls[0]![0] as { action: string; data: unknown };
    expect(row.action).toBe("exercise.invites_sent");
    expect(row.data).toEqual({ count: 3, sent: 2, failed: 1 });
    expect(JSON.stringify(row)).not.toContain("@example.com");
    expect(JSON.stringify(errors.mock.calls)).not.toContain("@example.com");
    errors.mockRestore();
  });

  it("is rate limited per exercise", async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await POST(req({ emails: "a@example.com" }), ctx)).status;
    expect(last).toBe(429);
  });
});
