import { describe, it, expect, vi, beforeEach } from "vitest";

// Strict founder lock rule end to end (ported from the hosted product, adapted
// to CE's single-org schema): reporter/assignee are enrolled as removable
// participants (no implicit access); the participant helper is idempotent;
// someone a locked incident excludes can't be paged into it; and the M7
// IC-seat / unlock decisions.

const mockDb = {
  user: { findUnique: vi.fn(), findMany: vi.fn() },
  incident: { findUnique: vi.fn() },
  incidentParticipant: { upsert: vi.fn() },
};
vi.mock("@/lib/db", () => ({ db: mockDb }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ensureIncidentParticipants", () => {
  it("enrols same-org users once each (idempotent upsert), ignoring nulls and other orgs", async () => {
    mockDb.user.findMany.mockResolvedValue([{ id: "rep", name: "Rep", email: "r@x" }]);
    const { ensureIncidentParticipants } = await import("./participants");
    const n = await ensureIncidentParticipants({
      organizationId: "org-1",
      incidentId: "inc-1",
      userIds: ["rep", "rep", null, undefined, "foreign"],
      addedBy: { id: "rep", name: "Rep" },
    });
    expect(n).toBe(1);
    expect(mockDb.user.findMany.mock.calls[0]![0].where).toEqual({ id: { in: ["rep", "foreign"] }, organizationId: "org-1" });
    const up = mockDb.incidentParticipant.upsert.mock.calls[0]![0];
    expect(up.where).toEqual({ incidentId_userId: { incidentId: "inc-1", userId: "rep" } });
    expect(up.create).toMatchObject({ organizationId: "org-1", userName: "Rep", role: "responder", addedById: "rep" });
    expect(up.update).toEqual({}); // never overwrites an existing row
  });

  it("no ids -> no queries", async () => {
    const { ensureIncidentParticipants } = await import("./participants");
    expect(await ensureIncidentParticipants({ organizationId: "org-1", incidentId: "inc-1", userIds: [null] })).toBe(0);
    expect(mockDb.user.findMany).not.toHaveBeenCalled();
  });
});

describe("canUserSeeIncident (who may be paged into a locked incident)", () => {
  const locked = (over: Record<string, unknown> = {}) => ({
    organizationId: "org-1",
    restricted: true,
    deletedAt: null,
    participants: [],
    roleAssignments: [],
    ...over,
  });

  it("a reporter who was removed from the allowlist can NOT see it; a participant can", async () => {
    const { canUserSeeIncident } = await import("./access");
    mockDb.user.findUnique.mockResolvedValue({ id: "rep", organizationId: "org-1", role: "contributor", isActive: true });
    mockDb.incident.findUnique.mockResolvedValue(locked());
    expect(await canUserSeeIncident("rep", "inc-1")).toBe(false);
    mockDb.incident.findUnique.mockResolvedValue(locked({ participants: [{ id: "p" }] }));
    expect(await canUserSeeIncident("rep", "inc-1")).toBe(true);
  });

  it("org admins and the IC always can; inactive users and soft-deleted incidents never", async () => {
    const { canUserSeeIncident } = await import("./access");
    mockDb.incident.findUnique.mockResolvedValue(locked());
    mockDb.user.findUnique.mockResolvedValue({ id: "a", organizationId: "org-1", role: "administrator", isActive: true });
    expect(await canUserSeeIncident("a", "inc-1")).toBe(true);
    mockDb.incident.findUnique.mockResolvedValue(locked({ deletedAt: new Date() }));
    expect(await canUserSeeIncident("a", "inc-1")).toBe(false);
    mockDb.user.findUnique.mockResolvedValue({ id: "ic", organizationId: "org-1", role: "contributor", isActive: true });
    mockDb.incident.findUnique.mockResolvedValue(locked({ roleAssignments: [{ id: "r" }] }));
    expect(await canUserSeeIncident("ic", "inc-1")).toBe(true);
    mockDb.user.findUnique.mockResolvedValue({ id: "ic", organizationId: "org-1", role: "contributor", isActive: false });
    expect(await canUserSeeIncident("ic", "inc-1")).toBe(false);
  });
});

describe("M7 decisions (lock-shared, client-safe)", () => {
  it("canUnlockIncident: admins always; the lock-time IC only while still seated; nobody else", async () => {
    const { canUnlockIncident } = await import("./lock-shared");
    const inc = { restricted: true, lockedIcUserId: "ic-1" };
    expect(canUnlockIncident({ id: "a", role: "administrator" }, inc, false)).toBe(true);
    expect(canUnlockIncident({ id: "ic-1", role: "contributor" }, inc, true)).toBe(true);
    // The lock-time IC who has since lost the seat.
    expect(canUnlockIncident({ id: "ic-1", role: "contributor" }, inc, false)).toBe(false);
    // A later IC (not the one captured at lock time).
    expect(canUnlockIncident({ id: "ic-2", role: "contributor" }, inc, true)).toBe(false);
    // Locked before capture existed -> admin-only.
    expect(canUnlockIncident({ id: "ic-1", role: "contributor" }, { restricted: true, lockedIcUserId: null }, true)).toBe(false);
    // Not locked -> nothing to unlock.
    expect(canUnlockIncident({ id: "a", role: "administrator" }, { restricted: false, lockedIcUserId: null }, false)).toBe(false);
  });

  it("canAssignIncidentCommander: empty seat = reporter/admin; occupied = current IC/reporter/admin", async () => {
    const { canAssignIncidentCommander } = await import("./lock-shared");
    const inc = { reportedById: "rep" };
    const empty = { occupied: false, currentIcUserId: null };
    const seated = { occupied: true, currentIcUserId: "ic" };
    expect(canAssignIncidentCommander({ id: "x", role: "contributor" }, inc, empty)).toBe(false);
    expect(canAssignIncidentCommander({ id: "rep", role: "contributor" }, inc, empty)).toBe(true);
    expect(canAssignIncidentCommander({ id: "a", role: "administrator" }, inc, empty)).toBe(true);
    expect(canAssignIncidentCommander({ id: "ic", role: "contributor" }, inc, seated)).toBe(true);
    expect(canAssignIncidentCommander({ id: "x", role: "contributor" }, inc, seated)).toBe(false);
    expect(canAssignIncidentCommander({ id: "rep", role: "contributor" }, inc, seated)).toBe(true);
  });
});
