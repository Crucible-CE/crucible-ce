// Standard auth gate for org-admin API routes. Centralizes the "is this an
// authenticated admin, and which org are they scoped to" check so every admin
// endpoint enforces it identically (auth required + org isolation).
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";

export interface AdminContext {
  userId: string;
  organizationId: string;
  email: string | null;
  name: string | null;
}

// Returns the admin context, or null if the caller is not an authenticated
// admin. Routes should 401/403 on null.
export async function getAdminContext(): Promise<AdminContext | null> {
  const session = await auth();
  const u = session?.user;
  if (!u?.id || !u.organizationId) return null;
  if (!hasPermission(u, "admin.access")) return null;
  return {
    userId: u.id,
    organizationId: u.organizationId,
    email: u.email ?? null,
    name: u.name ?? null,
  };
}
