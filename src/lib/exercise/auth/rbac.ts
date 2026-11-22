// Exercise permissions, derived from the CE account role.
//
//   administrator     -> admin        settings, users, every exercise
//   exercise_director -> director     the exercise program: every exercise,
//                                     templates, documents, reports, the
//                                     improvement plan and the schedule
//   contributor       -> facilitator  create and run exercises, templates, documents
//   reader            -> member       join exercises, read reports
//
// The director mirrors Crucible Cloud's exercise_director: it runs exercises
// it did not create (Cloud's exercises.facilitate) but has no org admin
// rights (settings.manage, users.manage stay with administrators).
//
// Exercise roles (lead facilitator, controller, evaluator, scribe, player,
// observer) live on Participant, per exercise, not here.

import type { Role as CeRole } from "@/lib/auth/rbac";

export const ACCOUNT_ROLES = ["admin", "director", "facilitator", "member"] as const;
export type Role = (typeof ACCOUNT_ROLES)[number];

const FROM_CE_ROLE: Record<CeRole, Role> = {
  administrator: "admin",
  exercise_director: "director",
  contributor: "facilitator",
  reader: "member",
};

/** The exercise role for a CE account role, or null for an unknown role. */
export function exerciseRoleFor(ceRole: string | null | undefined): Role | null {
  if (!ceRole) return null;
  return (FROM_CE_ROLE as Record<string, Role | undefined>)[ceRole] ?? null;
}

/** The CE account role an exercise role came from (for incident access checks). */
export function ceRoleFor(role: Role): CeRole {
  return (Object.keys(FROM_CE_ROLE) as CeRole[]).find((k) => FROM_CE_ROLE[k] === role) ?? "reader";
}

export const PERMISSIONS = [
  "settings.manage",
  "users.manage",
  "exercises.create",
  "exercises.view_all",
  /** Control and drive any exercise without a seat, as its owner would. */
  "exercises.manage_all",
  "templates.manage",
  "documents.manage",
  "reports.view",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const FACILITATOR: readonly Permission[] = ["exercises.create", "exercises.view_all", "templates.manage", "documents.manage", "reports.view"];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  member: [],
  facilitator: FACILITATOR,
  director: [...FACILITATOR, "exercises.manage_all"],
  admin: [...PERMISSIONS],
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ACCOUNT_ROLES as readonly string[]).includes(value);
}

export interface RBACUser {
  id?: string;
  role?: string | null;
}

export function hasPermission(user: RBACUser | null | undefined, permission: Permission): boolean {
  if (!user?.id || !isRole(user.role)) return false;
  return ROLE_PERMISSIONS[user.role].includes(permission);
}

/** Does this exercise account role control every exercise (administrators and exercise directors)? */
export function managesAllExercises(role: string | null | undefined): boolean {
  return isRole(role) && ROLE_PERMISSIONS[role].includes("exercises.manage_all");
}
