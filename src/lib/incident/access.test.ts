import { describe, it, expect } from "vitest";
import { decideIncidentAccess, accessibleIncidentsWhere, type GateFields } from "./access";

const openIncident: GateFields = {
  organizationId: "org-1",
  restricted: false,
  reportedById: "reporter",
  assignedToId: "assignee",
};
const restricted: GateFields = { ...openIncident, restricted: true };

const member = { id: "u1", organizationId: "org-1" };
const otherOrg = { id: "u2", organizationId: "org-2" };

describe("decideIncidentAccess", () => {
  it("lets any same-org member see a non-restricted incident", () => {
    expect(decideIncidentAccess(member, openIncident, false)).toBe(true);
  });

  it("blocks a different-org member from a non-restricted incident", () => {
    expect(decideIncidentAccess(otherOrg, openIncident, false)).toBe(false);
  });

  it("hides a restricted incident from a same-org non-participant", () => {
    expect(decideIncidentAccess(member, restricted, false)).toBe(false);
  });

  it("shows a restricted incident to a participant", () => {
    expect(decideIncidentAccess(member, restricted, true)).toBe(true);
  });

  it("gives the reporter no implicit access (strict rule: they are an ordinary, removable participant)", () => {
    const reporter = { id: "reporter", organizationId: "org-1" };
    expect(decideIncidentAccess(reporter, restricted, false)).toBe(false);
    expect(decideIncidentAccess(reporter, restricted, true)).toBe(true);
  });

  it("gives the assignee no implicit access", () => {
    const assignee = { id: "assignee", organizationId: "org-1" };
    expect(decideIncidentAccess(assignee, restricted, false)).toBe(false);
  });

  it("hides a soft-deleted incident from everyone, administrators included", () => {
    const deleted = { ...openIncident, deletedAt: new Date() };
    expect(decideIncidentAccess(member, deleted, true)).toBe(false);
    expect(decideIncidentAccess({ ...member, role: "administrator" }, deleted, true, true)).toBe(false);
  });

  it("blocks a different-org user from a restricted incident even as a participant", () => {
    expect(decideIncidentAccess(otherOrg, restricted, true)).toBe(false);
  });

  it("the incident commander always sees a locked incident", () => {
    expect(decideIncidentAccess(member, restricted, false, true)).toBe(true);
  });

  it("an org administrator always sees a locked incident (lock-exempt)", () => {
    expect(decideIncidentAccess({ ...member, role: "administrator" }, restricted, false)).toBe(true);
  });

  it("an administrator of a different org still cannot see it", () => {
    expect(decideIncidentAccess({ ...otherOrg, role: "administrator" }, restricted, false)).toBe(false);
  });
});

describe("accessibleIncidentsWhere", () => {
  it("scopes to org, excludes deleted, and ORs in only the participant / IC escape hatches", () => {
    const where = accessibleIncidentsWhere(member);
    expect(where.organizationId).toBe("org-1");
    expect(where.deletedAt).toBeNull();
    expect(where.OR).toEqual([
      { restricted: false },
      { participants: { some: { userId: "u1" } } },
      { roleAssignments: { some: { role: "incident_commander", userId: "u1" } } },
    ]);
  });

  it("administrators see every incident in their org (no lock filter)", () => {
    expect(accessibleIncidentsWhere({ ...member, role: "administrator" })).toEqual({ organizationId: "org-1", deletedAt: null });
  });
});
