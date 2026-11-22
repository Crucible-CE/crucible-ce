import { describe, expect, it } from "vitest";
import { ORG_ROLES } from "@/lib/auth/rbac";
import { ORG_INVITE_ALLOWED_ROLES } from "@/lib/org-invite/tokens";
import { roleSeesCloudNotes } from "@/lib/cloud/notes";
import { ACCOUNT_ROLES, PERMISSIONS, ceRoleFor, exerciseRoleFor, hasPermission, managesAllExercises, type Permission } from "./rbac";

// The exercise permission matrix, one row per CE account role.
const MATRIX: Record<string, Permission[]> = {
  reader: [],
  contributor: ["exercises.create", "exercises.view_all", "templates.manage", "documents.manage", "reports.view"],
  exercise_director: ["exercises.create", "exercises.view_all", "exercises.manage_all", "templates.manage", "documents.manage", "reports.view"],
  administrator: [...PERMISSIONS],
};

describe("exercise role matrix", () => {
  it("covers every CE role", () => {
    expect(Object.keys(MATRIX).sort()).toEqual([...ORG_ROLES].sort());
  });

  for (const [ceRole, granted] of Object.entries(MATRIX)) {
    it(`${ceRole} has exactly its permissions`, () => {
      const role = exerciseRoleFor(ceRole);
      expect(role).not.toBeNull();
      const u = { id: "u1", role };
      for (const p of PERMISSIONS) expect(hasPermission(u, p), `${ceRole} ${p}`).toBe(granted.includes(p));
    });
  }

  it("keeps settings and members with administrators", () => {
    const director = { id: "u1", role: exerciseRoleFor("exercise_director") };
    expect(hasPermission(director, "settings.manage")).toBe(false);
    expect(hasPermission(director, "users.manage")).toBe(false);
  });

  it("lets administrators and directors control every exercise", () => {
    expect(ACCOUNT_ROLES.filter(managesAllExercises)).toEqual(["admin", "director"]);
    expect(managesAllExercises(null)).toBe(false);
  });

  it("maps back to the CE role", () => {
    for (const r of ORG_ROLES) expect(ceRoleFor(exerciseRoleFor(r)!)).toBe(r);
  });
});

describe("exercise_director elsewhere", () => {
  it("can be invited", () => {
    expect([...ORG_INVITE_ALLOWED_ROLES].sort()).toEqual([...ORG_ROLES].sort());
  });

  it("sees Cloud notes, readers do not", () => {
    expect(roleSeesCloudNotes("exercise_director")).toBe(true);
    expect(roleSeesCloudNotes("contributor")).toBe(true);
    expect(roleSeesCloudNotes("administrator")).toBe(true);
    expect(roleSeesCloudNotes("reader")).toBe(false);
  });
});
