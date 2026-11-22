import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { UserManagement } from "@/components/admin/user-management";
import { OrgInvitePanel } from "@/components/admin/org-invite-panel";
import { MfaPolicyCard } from "@/components/admin/mfa-policy-card";
import { memberMfaStatus } from "@/lib/auth/mfa/org-status";
import { activeEmailTransport } from "@/lib/email/transport";

// Org members management, scoped to the caller's organization.
export default async function OrgMembersPage() {
  const session = await auth();
  if (!session?.user?.organizationId) redirect("/login");
  if (!hasPermission(session.user, "admin.access")) redirect("/dashboard");

  const orgUsers = await db.user.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, email: true, role: true, isActive: true,
      lastLoginAt: true, createdAt: true,
    },
  });

  // Notification-phone status per member (for the admin toll-fraud override).
  const phoneRows = await db.userNotificationSetting.findMany({
    where: { userId: { in: orgUsers.map((u) => u.id) } },
    select: { userId: true, notificationPhone: true, notificationPhoneVerifiedAt: true, allowUnverifiedPhone: true },
  });
  const phoneBy = new Map(phoneRows.map((r) => [r.userId, r]));
  const [mfaBy, org] = await Promise.all([
    memberMfaStatus(orgUsers.map((u) => u.id)),
    db.organization.findUnique({ where: { id: session.user.organizationId }, select: { requireMfa: true } }),
  ]);
  const membersWithoutMfa = orgUsers.filter((u) => u.isActive && !mfaBy.has(u.id)).length;
  const selfHasMfa = mfaBy.has(session.user.id ?? "");

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="headline">Members</h1>
        <p className="text-[13px] text-[color:var(--color-muted-foreground)]">Invite people, set roles and manage access.</p>
      </div>

      <MfaPolicyCard initialRequireMfa={org?.requireMfa ?? false} membersWithoutMfa={membersWithoutMfa} selfHasMfa={selfHasMfa} />

      <OrgInvitePanel />

      <UserManagement
        initialUsers={orgUsers.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          isActive: u.isActive,
          lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
          createdAt: u.createdAt.toISOString(),
          notificationPhone: phoneBy.get(u.id)?.notificationPhone ?? null,
          phoneVerified: !!phoneBy.get(u.id)?.notificationPhoneVerifiedAt,
          phoneOverride: !!phoneBy.get(u.id)?.allowUnverifiedPhone,
          mfa: mfaBy.get(u.id) ?? null,
        }))}
        currentUserId={session.user.id ?? ""}
        emailConfigured={activeEmailTransport() !== null}
      />
    </div>
  );
}
