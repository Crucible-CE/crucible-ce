import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Swords } from "lucide-react";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { hasPermission } from "@/lib/exercise/auth/rbac";
import { getExerciseSettings } from "@/lib/exercise/settings";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { LIST_TABS, isListTab, listExercises, type ListTab } from "@/lib/exercise/list";
import { formatInZone } from "@/lib/exercise/time";
import { ROLE_LABELS, STATUS_LABELS } from "@/components/exercise/types";

export const dynamic = "force-dynamic";

const TABS: Array<{ key: ListTab; label: string; empty: string }> = [
  { key: "live", label: "Live", empty: "No exercise is running." },
  { key: "planned", label: "Planned", empty: "No exercises are planned." },
  { key: "ended", label: "Ended", empty: "No exercises have ended yet." },
];

export default async function ExercisesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { tab: rawTab } = await searchParams;
  const tab: ListTab = isListTab(rawTab) ? rawTab : "live";
  const [rows, instance] = await Promise.all([listExercises(user, { statuses: LIST_TABS[tab] }), getExerciseSettings()]);
  const tz = instance?.timezone ?? "UTC";
  const canCreate = hasPermission(user, "exercises.create");
  const current = TABS.find((t) => t.key === tab)!;

  return (
    <>
      <PageHeader
        title="Exercises"
        description="Crisis Sim, Playbook Exercise and Strategic TTX. Members join with their account, guests with an invite code."
        action={
          canCreate ? (
            <Link
              href="/exercises/new"
              className="inline-flex h-9 items-center gap-2 rounded-md bg-[color:var(--mist-indigo)] px-4 text-sm font-medium text-white hover:bg-[color:var(--mist-indigo-hi)]"
            >
              <Plus className="h-4 w-4" />
              New exercise
            </Link>
          ) : undefined
        }
      />
      <nav aria-label="Exercise status" className="mb-4 inline-flex rounded-lg bg-[color:var(--color-muted)] p-[3px]">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/exercises?tab=${t.key}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium",
              t.key === tab
                ? "bg-[color:var(--color-card)] text-[color:var(--mist-indigo)] shadow-[var(--elevation-0)]"
                : "text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState icon={Swords} title={current.empty} description={canCreate && tab !== "ended" ? "Start one from a template." : undefined} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => {
            const when = r.endedAt ?? r.startedAt ?? r.createdAt;
            return (
              <li key={r.id}>
                <Link href={`/exercises/${r.id}`} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-ring)]">
                  <Card dense className="h-full transition-shadow hover:shadow-[var(--elevation-2)]">
                    <div className="flex items-start gap-2">
                      <h2 className="min-w-0 flex-1 text-[15px] font-semibold leading-snug">{r.title}</h2>
                      <Badge variant={r.status === "live" ? "accent" : r.status === "paused" ? "warning" : "outline"}>{STATUS_LABELS[r.status] ?? r.status}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-[color:var(--color-muted-foreground)]">
                      <span>{r.modeLabel}</span>
                      <span>{r.participantCount} people</span>
                      {r.teamCount > 0 && <span>{r.teamCount} teams</span>}
                      <span>{formatInZone(when, tz)}</span>
                      {r.isPractice && <span>Practice</span>}
                    </div>
                    {r.myRoles.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {r.myRoles.map((role) => (
                          <Badge key={role} variant="secondary">
                            {ROLE_LABELS[role] ?? role}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
