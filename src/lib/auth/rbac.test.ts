import { describe, expect, it } from "vitest";
import {
  hasPermission,
  getEffectivePermissions,
  ORG_ROLES,
  PERMISSIONS,
  type RBACUser,
} from "./rbac";

function user(role: string): RBACUser {
  return { id: "u1", role, organizationId: "org1" };
}

describe("hasPermission", () => {
  it("returns false for null/undefined user", () => {
    expect(hasPermission(null, "incidents.view")).toBe(false);
    expect(hasPermission(undefined, "incidents.view")).toBe(false);
  });

  it("returns false for user without id", () => {
    expect(hasPermission({ role: "administrator" }, "admin.access")).toBe(false);
  });

  it("returns false for an unknown role", () => {
    expect(hasPermission(user("nonexistent"), "incidents.view")).toBe(false);
  });

  it("reader can view incidents but not edit them", () => {
    const u = user("reader");
    expect(hasPermission(u, "incidents.view")).toBe(true);
    expect(hasPermission(u, "incidents.edit")).toBe(false);
    expect(hasPermission(u, "admin.access")).toBe(false);
  });

  it("contributor can view and edit incidents", () => {
    const u = user("contributor");
    expect(hasPermission(u, "incidents.view")).toBe(true);
    expect(hasPermission(u, "incidents.edit")).toBe(true);
  });

  it("contributor cannot delete, export or administer", () => {
    const u = user("contributor");
    expect(hasPermission(u, "incidents.delete")).toBe(false);
    expect(hasPermission(u, "incidents.export")).toBe(false);
    expect(hasPermission(u, "users.manage")).toBe(false);
    expect(hasPermission(u, "admin.access")).toBe(false);
  });

  it("administrator has every permission", () => {
    const u = user("administrator");
    for (const p of PERMISSIONS) expect(hasPermission(u, p)).toBe(true);
  });
});

describe("getEffectivePermissions", () => {
  it("returns an empty list without a user or role", () => {
    expect(getEffectivePermissions(null)).toEqual([]);
    expect(getEffectivePermissions({ id: "u1" })).toEqual([]);
  });

  it("returns the role's permissions", () => {
    expect(getEffectivePermissions(user("contributor")).sort()).toEqual(
      ["incidents.edit", "incidents.view"],
    );
  });

  it("every org role resolves to a permission set", () => {
    for (const r of ORG_ROLES) {
      expect(getEffectivePermissions(user(r)).length).toBeGreaterThan(0);
    }
  });
});

describe("exercise_director", () => {
  it("works incidents like a contributor, without incident or org admin", () => {
    const u = user("exercise_director");
    expect(getEffectivePermissions(u).sort()).toEqual(["incidents.edit", "incidents.view"]);
    for (const p of ["incidents.delete", "incidents.export", "users.view", "users.manage", "admin.access"] as const) {
      expect(hasPermission(u, p)).toBe(false);
    }
  });

  it("has a label and help for role pickers", async () => {
    const { ROLE_LABELS, ROLE_HELP, roleLabel } = await import("./rbac");
    for (const r of ORG_ROLES) {
      expect(ROLE_LABELS[r]).toBeTruthy();
      expect(ROLE_HELP[r]).toMatch(/\.$/);
      expect(ROLE_HELP[r]).not.toMatch(/[–—]/);
    }
    expect(roleLabel("exercise_director")).toBe("Exercise director");
    expect(roleLabel("unknown")).toBe("unknown");
  });
});
