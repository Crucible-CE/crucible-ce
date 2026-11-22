import { describe, it, expect, vi, beforeEach } from "vitest";

const mockIncidentFindUnique = vi.fn();
const mockUserFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    incident: { findUnique: (...a: unknown[]) => mockIncidentFindUnique(...a) },
    user: { findMany: (...a: unknown[]) => mockUserFindMany(...a) },
  },
}));

import { canAccessIncident, usersWithIncidentAccess } from "./access";
import { accessibleIncidentsWhere } from "@/lib/incident/access";

const base: { organizationId: string; restricted: boolean; deletedAt: Date | null } = {
  organizationId: "org-1",
  restricted: true,
  deletedAt: null,
};

/** Row as Prisma would return it for a single-user canAccessIncident query. */
function single(over: Partial<typeof base> & { participant?: boolean; ic?: boolean } = {}) {
  const { participant, ic, ...rest } = over;
  return {
    ...base,
    ...rest,
    participants: participant ? [{ id: "p" }] : [],
    roleAssignments: ic ? [{ id: "r" }] : [],
  };
}

const u = (userId: string, role = "contributor", organizationId = "org-1") => ({
  userId,
  role,
  organizationId,
});

describe("canAccessIncident (war-room join) honours the lock", () => {
  beforeEach(() => mockIncidentFindUnique.mockReset());

  it("unlocked: any org member", async () => {
    mockIncidentFindUnique.mockResolvedValueOnce(single({ restricted: false }));
    expect(await canAccessIncident("i1", u("stranger", "reader"))).toBe(true);
  });

  it("other org: denied even when unlocked", async () => {
    mockIncidentFindUnique.mockResolvedValueOnce(single({ restricted: false }));
    expect(await canAccessIncident("i1", u("x", "administrator", "org-2"))).toBe(false);
  });

  it("locked: an org administrator who is NOT a participant still gets in", async () => {
    mockIncidentFindUnique.mockResolvedValueOnce(single());
    expect(await canAccessIncident("i1", u("admin", "administrator"))).toBe(true);
  });

  it("locked: a non-participant non-admin is denied", async () => {
    mockIncidentFindUnique.mockResolvedValueOnce(single());
    expect(await canAccessIncident("i1", u("stranger"))).toBe(false);
  });

  it("locked: participants and the IC are allowed", async () => {
    mockIncidentFindUnique.mockResolvedValueOnce(single({ participant: true }));
    expect(await canAccessIncident("i1", u("p1"))).toBe(true);
    mockIncidentFindUnique.mockResolvedValueOnce(single({ ic: true }));
    expect(await canAccessIncident("i1", u("ic"))).toBe(true);
  });

  it("locked (strict rule): a reporter/assignee NOT on the allowlist is denied", async () => {
    mockIncidentFindUnique.mockResolvedValueOnce(single());
    expect(await canAccessIncident("i1", u("reporter", "reader"))).toBe(false);
    mockIncidentFindUnique.mockResolvedValueOnce(single());
    expect(await canAccessIncident("i1", u("assignee"))).toBe(false);
    // The query never asks for reporter/assignee — they carry no grant.
    const select = mockIncidentFindUnique.mock.calls[0][0].select;
    expect(select.reportedById).toBeUndefined();
    expect(select.assignedToId).toBeUndefined();
    expect(select.deletedAt).toBe(true);
  });

  it("soft-deleted incident: denied to everyone, admins included", async () => {
    mockIncidentFindUnique.mockResolvedValueOnce(single({ restricted: false, deletedAt: new Date() }));
    expect(await canAccessIncident("i1", u("admin", "administrator"))).toBe(false);
  });

  it("missing incident: denied", async () => {
    mockIncidentFindUnique.mockResolvedValueOnce(null);
    expect(await canAccessIncident("gone", u("admin", "administrator"))).toBe(false);
  });

  it("agrees with accessibleIncidentsWhere: admins get the org-only filter, others the lock OR", () => {
    expect(accessibleIncidentsWhere({ id: "a", organizationId: "org-1", role: "administrator" })).toEqual({
      organizationId: "org-1",
      deletedAt: null,
    });
    const w = accessibleIncidentsWhere({ id: "s", organizationId: "org-1", role: "contributor" });
    expect(w.deletedAt).toBeNull();
    expect(w.OR).toEqual([
      { restricted: false },
      { participants: { some: { userId: "s" } } },
      { roleAssignments: { some: { role: "incident_commander", userId: "s" } } },
    ]);
  });
});

describe("usersWithIncidentAccess (batch, DB-current state)", () => {
  beforeEach(() => {
    mockIncidentFindUnique.mockReset();
    mockUserFindMany.mockReset();
  });

  it("returns only users who still pass the lock, judged on DB role/isActive", async () => {
    mockIncidentFindUnique.mockResolvedValueOnce({
      ...base,
      participants: [{ userId: "part" }],
      roleAssignments: [{ userId: "ic" }],
    });
    mockUserFindMany.mockResolvedValueOnce([
      { id: "admin", organizationId: "org-1", role: "administrator", isActive: true },
      { id: "part", organizationId: "org-1", role: "reader", isActive: true },
      { id: "ic", organizationId: "org-1", role: "contributor", isActive: true },
      { id: "stranger", organizationId: "org-1", role: "contributor", isActive: true },
      { id: "demoted", organizationId: "org-1", role: "contributor", isActive: true },
      { id: "gone-admin", organizationId: "org-1", role: "administrator", isActive: false },
    ]);
    const allowed = await usersWithIncidentAccess("i1", [
      "admin",
      "part",
      "ic",
      "stranger",
      "demoted",
      "gone-admin",
      "deleted",
      "admin",
    ]);
    expect([...allowed].sort()).toEqual(["admin", "ic", "part"]);
    // One incident query + one user query, de-duplicated ids.
    expect(mockIncidentFindUnique).toHaveBeenCalledTimes(1);
    expect(mockUserFindMany).toHaveBeenCalledTimes(1);
    const where = mockUserFindMany.mock.calls[0][0].where;
    expect(where.id.in).toHaveLength(7);
  });

  it("deleted incident → nobody", async () => {
    mockIncidentFindUnique.mockResolvedValueOnce(null);
    mockUserFindMany.mockResolvedValueOnce([
      { id: "admin", organizationId: "org-1", role: "administrator", isActive: true },
    ]);
    expect((await usersWithIncidentAccess("i1", ["admin"])).size).toBe(0);
  });

  it("no users → no queries", async () => {
    expect((await usersWithIncidentAccess("i1", [])).size).toBe(0);
    expect(mockIncidentFindUnique).not.toHaveBeenCalled();
  });
});
