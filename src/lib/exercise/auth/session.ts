// Route-handler and server-component guards for exercise code.
//
//   const a = await requireUser();
//   if (!a.ok) return a.response;          // 401 JSON
//   a.user.id
//
//   const a = await requireRole("admin");  // 401 or 403 JSON
//   const a = await requirePermission("exercises.create");
//
// The session comes from CE's Auth.js instance, which re-validates the user
// against the database on every call (tokenVersion, active, organization).
// The CE account role is mapped onto the exercise role (./rbac).

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { exerciseRoleFor, hasPermission, type Permission, type Role } from "@/lib/exercise/auth/rbac";

export interface SessionUser {
  id: string;
  /** Exercise role derived from the CE account role. */
  role: Role;
  name: string;
  email: string;
  organizationId: string;
}

export type GuardResult = { ok: true; user: SessionUser } | { ok: false; response: NextResponse };

export const UNAUTHORIZED_BODY = { error: "Sign in to continue." } as const;
export const FORBIDDEN_BODY = { error: "You do not have access to this." } as const;

/** The signed-in user, or null. A member still owing two-factor setup is null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const u = session?.user;
  const role = exerciseRoleFor(u?.role);
  if (!u?.id || !role || !u.organizationId || u.mfaEnrollRequired) return null;
  return { id: u.id, role, name: u.name ?? "", email: u.email ?? "", organizationId: u.organizationId };
}

export async function requireUser(): Promise<GuardResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, response: NextResponse.json(UNAUTHORIZED_BODY, { status: 401 }) };
  return { ok: true, user };
}

/** Signed in AND the role grants `permission`. */
export async function requirePermission(permission: Permission): Promise<GuardResult> {
  const r = await requireUser();
  if (!r.ok) return r;
  if (!hasPermission(r.user, permission)) return { ok: false, response: NextResponse.json(FORBIDDEN_BODY, { status: 403 }) };
  return r;
}
