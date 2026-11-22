// ---------------------------------------------------------------------------
// Crucible CE RBAC — Centralized permission system
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Role types
// ---------------------------------------------------------------------------

export const ORG_ROLES = ["reader", "contributor", "exercise_director", "administrator"] as const;

export type Role = (typeof ORG_ROLES)[number];

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export const PERMISSIONS = [
  // Incidents
  "incidents.view",
  "incidents.edit",
  "incidents.delete",
  "incidents.export", // generate the signed, encrypted incident case file
  // User management
  "users.view",
  "users.manage",
  // Admin
  "admin.access",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// ---------------------------------------------------------------------------
// Role → Permission mapping
// ---------------------------------------------------------------------------

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  reader: ["incidents.view"],

  contributor: ["incidents.view", "incidents.edit"],

  // As in Crucible Cloud: incident work as a contributor, no incident admin
  // and no org admin. The exercise program rights are in
  // src/lib/exercise/auth/rbac.ts (exercise account role "director").
  exercise_director: ["incidents.view", "incidents.edit"],

  administrator: [
    "incidents.view",
    "incidents.edit",
    "incidents.delete",
    "incidents.export",
    "users.view",
    "users.manage",
    "admin.access",
  ],
};

// ---------------------------------------------------------------------------
// Labels and help for role pickers (client safe: no server imports here)
// ---------------------------------------------------------------------------

export const ROLE_LABELS: Record<Role, string> = {
  reader: "Reader",
  contributor: "Contributor",
  exercise_director: "Exercise director",
  administrator: "Administrator",
};

export const ROLE_HELP: Record<Role, string> = {
  reader: "Views incidents, joins exercises and reads reports.",
  contributor: "Works incidents and runs the exercises they create.",
  exercise_director: "Runs the exercise program and every exercise in it.",
  administrator: "Everything, plus members and org settings.",
};

/** The label for a role, or the raw value for an unknown one. */
export function roleLabel(role: string | null | undefined): string {
  return role && Object.prototype.hasOwnProperty.call(ROLE_LABELS, role) ? ROLE_LABELS[role as Role] : (role ?? "");
}

// ---------------------------------------------------------------------------
// Session user shape (matches NextAuth session.user)
// ---------------------------------------------------------------------------

export interface RBACUser {
  id?: string;
  role?: string;
  organizationId?: string;
}

// ---------------------------------------------------------------------------
// Permission checks
// ---------------------------------------------------------------------------

/**
 * Check if a user has a specific permission based on their org role.
 */
export function hasPermission(user: RBACUser | null | undefined, permission: Permission): boolean {
  if (!user?.id) return false;
  const role = user.role as Role | undefined;
  if (!role) return false;
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;
  return permissions.includes(permission);
}

/**
 * Get all effective permissions for a user.
 */
export function getEffectivePermissions(user: RBACUser | null | undefined): Permission[] {
  if (!user?.id) return [];
  const role = user.role as Role | undefined;
  if (!role) return [];
  const permissions = ROLE_PERMISSIONS[role];
  return permissions ? [...permissions] : [];
}
