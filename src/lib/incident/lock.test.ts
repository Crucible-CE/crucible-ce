import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const findFirstRole = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    incident: { findUnique: (...a: unknown[]) => findUnique(...a) },
    incidentRoleAssignment: { findFirst: (...a: unknown[]) => findFirstRole(...a) },
  },
}));

import {
  canManageLock,
  canWriteLockedIncident,
  apiErrorMessage,
  isIncidentLockedError,
  INCIDENT_LOCKED_CODE,
  INCIDENT_LOCKED_MESSAGE,
} from "./lock-shared";
import { assertIncidentWritable, canManageIncidentLock, isIncidentReadOnlyFor } from "./lock";

const contributor = { id: "u1", role: "contributor" };
const reader = { id: "u2", role: "reader" };
const admin = { id: "a1", role: "administrator" };

describe("canWriteLockedIncident (pure decision)", () => {
  it("an unlocked incident is writable by anyone (permissions still apply)", () => {
    expect(canWriteLockedIncident(contributor, { restricted: false }, false)).toBe(true);
    expect(canWriteLockedIncident(reader, { restricted: false }, false)).toBe(true);
  });
  it("a locked incident is read-only for a non-IC contributor", () => {
    expect(canWriteLockedIncident(contributor, { restricted: true }, false)).toBe(false);
  });
  it("the incident commander keeps edit rights on a locked incident", () => {
    expect(canWriteLockedIncident(contributor, { restricted: true }, true)).toBe(true);
  });
  it("administrators keep edit rights on a locked incident", () => {
    expect(canWriteLockedIncident(admin, { restricted: true }, false)).toBe(true);
  });
});

describe("canManageLock (pure decision)", () => {
  const unlocked = { restricted: false, reportedById: "u1" };
  const locked = { restricted: true, reportedById: "u1" };
  it("the reporter may lock an unlocked incident", () => {
    expect(canManageLock(contributor, unlocked, false)).toBe(true);
  });
  it("the reporter may NOT unlock or manage participants once locked", () => {
    expect(canManageLock(contributor, locked, false)).toBe(false);
  });
  it("the IC and admins may manage the lock either way", () => {
    expect(canManageLock({ id: "x", role: "contributor" }, locked, true)).toBe(true);
    expect(canManageLock(admin, locked, false)).toBe(true);
    expect(canManageLock(admin, unlocked, false)).toBe(true);
  });
  it("an unrelated member may not manage the lock", () => {
    expect(canManageLock({ id: "zz", role: "contributor" }, unlocked, false)).toBe(false);
  });
});

describe("lock error helpers", () => {
  it("recognises the lock error body and maps it to the lock message", () => {
    const body = { error: "Incident is locked", code: INCIDENT_LOCKED_CODE };
    expect(isIncidentLockedError(body)).toBe(true);
    expect(apiErrorMessage(body, "Couldn't publish")).toBe(INCIDENT_LOCKED_MESSAGE);
  });
  it("falls back to message, then error, then the fallback", () => {
    expect(apiErrorMessage({ message: "m", error: "e" }, "f")).toBe("m");
    expect(apiErrorMessage({ error: "e" }, "f")).toBe("e");
    expect(apiErrorMessage(null, "f")).toBe("f");
  });
});

describe("assertIncidentWritable (route guard)", () => {
  beforeEach(() => {
    findUnique.mockReset();
    findFirstRole.mockReset();
  });

  it("returns null for an unlocked incident without touching the DB when restricted is known", async () => {
    expect(await assertIncidentWritable(contributor, { id: "i1", restricted: false })).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
    expect(findFirstRole).not.toHaveBeenCalled();
  });

  it("loads the lock flag when the caller didn't select it", async () => {
    findUnique.mockResolvedValueOnce({ restricted: false });
    expect(await assertIncidentWritable(contributor, { id: "i1" })).toBeNull();
    expect(findUnique).toHaveBeenCalledOnce();
  });

  it("returns a 403 incident_locked response for a non-IC contributor on a locked incident", async () => {
    findFirstRole.mockResolvedValueOnce(null);
    const res = await assertIncidentWritable(contributor, { id: "i1", restricted: true });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = await res!.json();
    expect(body.code).toBe("incident_locked");
    expect(body.message).toBe(INCIDENT_LOCKED_MESSAGE);
  });

  it("lets the incident commander through", async () => {
    findFirstRole.mockResolvedValueOnce({ id: "ra1" });
    expect(await assertIncidentWritable(contributor, { id: "i1", restricted: true })).toBeNull();
    expect(findFirstRole).toHaveBeenCalledWith(
      expect.objectContaining({ where: { incidentId: "i1", role: "incident_commander", userId: "u1" } }),
    );
  });

  it("lets an administrator through without an IC lookup", async () => {
    expect(await assertIncidentWritable(admin, { id: "i1", restricted: true })).toBeNull();
    expect(findFirstRole).not.toHaveBeenCalled();
  });

  it("isIncidentReadOnlyFor mirrors the guard", async () => {
    findFirstRole.mockResolvedValueOnce(null);
    expect(await isIncidentReadOnlyFor(contributor, { id: "i1", restricted: true })).toBe(true);
    expect(await isIncidentReadOnlyFor(admin, { id: "i1", restricted: true })).toBe(false);
  });
});

describe("canManageIncidentLock (DB wrapper)", () => {
  beforeEach(() => {
    findUnique.mockReset();
    findFirstRole.mockReset();
  });
  it("denies a different org", async () => {
    findUnique.mockResolvedValueOnce({ organizationId: "org-2", restricted: false, reportedById: "u1" });
    findFirstRole.mockResolvedValueOnce(null);
    expect(await canManageIncidentLock({ ...contributor, organizationId: "org-1" }, "i1")).toBe(false);
  });
  it("allows the reporter to lock an unlocked incident but not to unlock it", async () => {
    findUnique.mockResolvedValueOnce({ organizationId: "org-1", restricted: false, reportedById: "u1" });
    findFirstRole.mockResolvedValueOnce(null);
    expect(await canManageIncidentLock({ ...contributor, organizationId: "org-1" }, "i1")).toBe(true);
    findUnique.mockResolvedValueOnce({ organizationId: "org-1", restricted: true, reportedById: "u1" });
    findFirstRole.mockResolvedValueOnce(null);
    expect(await canManageIncidentLock({ ...contributor, organizationId: "org-1" }, "i1")).toBe(false);
  });
});
