import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import type { OrgProfile } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Building2,
  Users,
  MailPlus,
  Package,
  ShieldCheck,
  Check,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Organization management hub — the org profile, a members snapshot, and the
// edition card. CE has no plans or feature packages: the whole incident
// command core is included, always.
export default async function OrgAdminOrganizationPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user, "admin.access")) redirect("/dashboard");
  if (!session.user.organizationId) redirect("/dashboard");
  const orgId = session.user.organizationId;

  const now = new Date();
  const [org, activeMembers, adminCount, pendingInvites] = await Promise.all([
    db.organization.findUnique({
      where: { id: orgId },
      include: { _count: { select: { users: true } } },
    }),
    db.user.count({ where: { organizationId: orgId, isActive: true } }),
    db.user.count({ where: { organizationId: orgId, role: "administrator" } }),
    db.orgInvite.count({
      where: { organizationId: orgId, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
    }),
  ]);
  if (!org) redirect("/dashboard");

  const profile = (org.profileJson ?? {}) as OrgProfile;

  const profileFields: { label: string; value: string | null }[] = [
    { label: "Industry", value: org.industry },
    { label: "Region", value: org.region },
    { label: "Employee count", value: profile.employeeCount ?? null },
    { label: "Security maturity", value: profile.securityMaturity ?? null },
    { label: "IR framework", value: profile.irFramework ?? null },
    { label: "Regulatory notification SLA", value: profile.regulatoryNotificationSla ?? null },
    { label: "Risk appetite", value: profile.riskAppetite ?? null },
  ];
  const profileSet = profileFields.filter((f) => f.value).length;

  const stat = (label: string, value: string, icon: typeof Users, href?: string) => {
    const Icon = icon;
    const body = (
      <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon className="h-3.5 w-3.5" /> {label}
        </div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
      </div>
    );
    return href ? (
      <Link key={label} href={href} className="transition hover:opacity-80">
        {body}
      </Link>
    ) : (
      <div key={label}>{body}</div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="headline">Organization</h1>
        <p className="max-w-2xl text-[13px] leading-relaxed text-[color:var(--color-muted-foreground)]">
          {org.name} · {org.slug}
        </p>
      </div>

      {/* Snapshot */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stat("Members", `${org._count.users}`, Users, "/org-admin/members")}
        {stat("Active members", `${activeMembers}`, Check)}
        {stat("Admins", `${adminCount}`, ShieldCheck, "/org-admin/members")}
        {stat("Pending invites", `${pendingInvites}`, MailPlus, "/org-admin/members")}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Organization profile */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-[color:var(--mist-indigo)]" />
              Organization profile
            </CardTitle>
            <Button variant="outline" size="sm" asChild>
              <Link href="/org-profile">
                Edit profile
                <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {profileSet} of {profileFields.length} fields set.
            </p>
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {profileFields.map((f) => (
                <div key={f.label} className="flex items-center justify-between gap-2 border-b border-[color:var(--color-border)]/60 py-1.5 text-sm last:border-0 sm:[&:nth-last-child(2)]:border-0">
                  <span className="text-xs text-muted-foreground">{f.label}</span>
                  <span className={cn("text-right text-[13px] font-medium", !f.value && "font-normal text-muted-foreground/70")}>
                    {f.value ?? "Not set"}
                  </span>
                </div>
              ))}
            </div>
            {(profile.complianceFrameworks?.length ?? 0) > 0 && (
              <div>
                <p className="mb-1.5 text-xs text-muted-foreground">Compliance frameworks</p>
                <div className="flex flex-wrap gap-1.5">
                  {profile.complianceFrameworks!.map((fw) => (
                    <Badge key={fw} variant="secondary" className="text-[11px]">
                      {fw}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {(profile.cloudProviders?.length ?? 0) > 0 && (
              <div>
                <p className="mb-1.5 text-xs text-muted-foreground">Cloud providers</p>
                <div className="flex flex-wrap gap-1.5">
                  {profile.cloudProviders!.map((cp) => (
                    <Badge key={cp} variant="outline" className="text-[11px]">
                      {cp}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Edition */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-4 w-4 text-[color:var(--mist-indigo)]" />
              Edition
            </CardTitle>
            <Badge variant="default">Community Edition</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm leading-relaxed">
              Crucible CE: incidents, paging, guest links, status pages, messaging, exercises,
              after-action reports and the improvement program, for every member.
            </p>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Crucible Cloud adds AI features, hosted out-of-band delivery, a mobile app and
              regulatory filing drafts.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href="/cloud">
                About Crucible Cloud
                <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* People shortcut */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-[color:var(--mist-indigo)]" />
            People
          </CardTitle>
          <Button variant="outline" size="sm" asChild>
            <Link href="/org-admin/members">Manage members</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="flex items-center gap-1.5">
              <Users className="h-4 w-4 text-muted-foreground" />
              {org._count.users} members ({activeMembers} active)
            </span>
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              {adminCount} administrator{adminCount === 1 ? "" : "s"}
            </span>
            <span className="flex items-center gap-1.5">
              <MailPlus className="h-4 w-4 text-muted-foreground" />
              {pendingInvites} pending invite{pendingInvites === 1 ? "" : "s"}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
