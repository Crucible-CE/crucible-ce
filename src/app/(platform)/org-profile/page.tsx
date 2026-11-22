import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import type { OrgProfile } from "@/types";
import { OrgProfileClient } from "./org-profile-client";

export default async function OrgProfilePage() {
  const session = await auth();
  if (!session?.user?.organizationId) redirect("/login");

  const org = await db.organization.findUnique({
    where: { id: session.user.organizationId },
    include: {
      _count: { select: { users: true, incidents: true } },
    },
  });

  if (!org) redirect("/login");

  const isAdmin = hasPermission(session.user, "admin.access");
  // Security-posture data (stack, critical assets, attack surface, known
  // constraints) is contributor+; readers see the org card only.
  const canViewPosture = hasPermission(session.user, "incidents.edit");

  return (
    <OrgProfileClient
      org={{
        id: org.id,
        name: org.name,
        slug: org.slug,
        industry: org.industry,
        region: org.region,
        profileJson: (canViewPosture ? org.profileJson ?? {} : {}) as OrgProfile,
        memberCount: org._count.users,
        incidentCount: org._count.incidents,
      }}
      isAdmin={isAdmin}
      canViewPosture={canViewPosture}
      userId={session.user.id ?? ""}
    />
  );
}
