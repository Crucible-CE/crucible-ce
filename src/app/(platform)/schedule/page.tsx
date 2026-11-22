import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { hasPermission } from "@/lib/exercise/auth/rbac";
import { FRAMEWORKS } from "@/lib/exercise/content/frameworks";
import { PageHeader } from "@/components/shell/page-header";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";
import { feedEnabled } from "@/lib/exercise/schedule/feed-token";
import { instanceTimezone, listSchedules, MODE_NAMES } from "@/lib/exercise/schedule/service";
import { ScheduleClient, type TemplateOption } from "./schedule-client";

export const dynamic = "force-dynamic";

function briefOf(config: unknown): string | null {
  const b = (config as { executiveBriefMd?: unknown } | null)?.executiveBriefMd;
  return typeof b === "string" && b.trim() ? b.slice(0, 6000) : null;
}

export default async function SchedulePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const canEdit = hasPermission(user, "exercises.create");
  const [schedules, timezone, enabled] = await Promise.all([listSchedules(), instanceTimezone(), feedEnabled()]);
  const [templates, documents] = canEdit
    ? await Promise.all([
        db.exerciseTemplate.findMany({
          where: { status: { in: ["published", "draft"] } },
          select: { id: true, mode: true, title: true, status: true, config: true },
          orderBy: { title: "asc" },
          take: 500,
        }),
        db.sourceDocument.findMany({ select: { id: true, title: true }, orderBy: { title: "asc" }, take: 500 }),
      ])
    : [[], []];
  const templateOptions: TemplateOption[] = templates.map((t) => ({
    id: t.id,
    mode: t.mode,
    title: t.title,
    status: t.status,
    briefMd: briefOf(t.config),
  }));
  return (
    <ConfirmDialogProvider>
      <PageHeader title="Schedule" description={`Planned exercises, with calendar files and a private feed. Times are in ${timezone}.`} />
      <ScheduleClient
        initial={schedules}
        canEdit={canEdit}
        feedEnabled={enabled}
        timezone={timezone}
        templates={templateOptions}
        documents={documents}
        frameworks={FRAMEWORKS.map((f) => ({ key: f.id, label: f.label }))}
        modes={Object.entries(MODE_NAMES).map(([key, label]) => ({ key, label }))}
      />
    </ConfirmDialogProvider>
  );
}
