import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { hasPermission } from "@/lib/exercise/auth/rbac";
import { getExerciseSettings } from "@/lib/exercise/settings";
import { PageHeader } from "@/components/shell/page-header";
import { ActionItemsClient } from "@/components/aar/plan/action-items-client";

export const dynamic = "force-dynamic";

export default async function ActionItemsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!hasPermission(user, "reports.view")) {
    // Readers: the items they own (POC email), status and closure evidence only.
    const exercises = user.email
      ? await db.exercise.findMany({
          where: { actionItems: { some: { pocEmail: { equals: user.email, mode: "insensitive" } } } },
          orderBy: { endedAt: "desc" },
          select: { id: true, title: true },
          take: 500,
        })
      : [];
    return (
      <>
        <PageHeader title="Work items" description="Work items where you are the point of contact." />
        <ActionItemsClient options={{ exercises, capabilities: [] }} mine />
      </>
    );
  }
  const [instance, used, exercises] = await Promise.all([
    getExerciseSettings(),
    db.actionItem.findMany({ where: { capabilityId: { not: null } }, distinct: ["capabilityId"], select: { capabilityId: true } }),
    db.exercise.findMany({
      where: { actionItems: { some: {} } },
      orderBy: { endedAt: "desc" },
      select: { id: true, title: true },
      take: 500,
    }),
  ]);
  const capabilities = await db.capability.findMany({
    where: {
      OR: [
        { framework: instance?.capabilityFramework ?? "nist-csf", isActive: true },
        { id: { in: used.map((u) => u.capabilityId).filter((x): x is string => Boolean(x)) } },
      ],
    },
    orderBy: [{ framework: "asc" }, { seq: "asc" }],
    select: { id: true, key: true, name: true },
  });
  return (
    <>
      <PageHeader title="Work items" description="Corrective actions from the improvement plans of after-action reports." />
      <ActionItemsClient options={{ exercises, capabilities }} />
    </>
  );
}
