import Link from "next/link";
import { redirect } from "next/navigation";
import { FileCheck, TrendingUp } from "lucide-react";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { getExerciseSettings } from "@/lib/exercise/settings";
import { AAR_STATUSES, aarFiltersFrom, listAarRows, seesAllReports, type AarListFilters } from "@/lib/exercise/aar/register";
import { MODE_LABELS } from "@/lib/exercise/modes/registry";
import { MODES, type Mode } from "@/lib/exercise/runtime/types";
import { formatInZone } from "@/lib/exercise/time";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

const STATUS_TEXT: Record<string, string> = { draft: "Draft", review: "In review", final: "Final" };
const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary"> = { draft: "secondary", review: "warning", final: "success" };
const SIGNER_TEXT: Record<string, string> = { facilitator: "Facilitator", sponsor: "Sponsor" };

const SELECT =
  "h-9 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-input)] px-3 text-sm text-[color:var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-ring)]";

function hasFilters(f: AarListFilters): boolean {
  return Boolean(f.status || f.mode || f.from || f.to || f.q);
}

export default async function AfterActionReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const filters = aarFiltersFrom(await searchParams);
  const all = seesAllReports(user);
  const [rows, settings] = await Promise.all([listAarRows(user, filters), getExerciseSettings()]);
  const tz = settings?.timezone ?? "UTC";
  const day = (iso: string | null) => (iso ? formatInZone(new Date(iso), tz).slice(0, 10) : "");

  return (
    <>
      <PageHeader
        title="After-action reports"
        description={all ? "Reports from ended exercises, newest first." : "Final reports of the exercises you took part in."}
        action={
          all ? (
            <Link
              href="/after-action-reports/maturity"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-[color:var(--color-border)] px-3 text-sm font-medium hover:bg-[color:var(--color-muted)]"
            >
              <TrendingUp className="h-4 w-4" />
              Capability maturity
            </Link>
          ) : undefined
        }
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3" aria-label="Filter reports">
        <div className="space-y-1">
          <Label htmlFor="aar-q">Exercise</Label>
          <Input id="aar-q" name="q" type="search" defaultValue={filters.q ?? ""} placeholder="Search by title" className="w-[220px]" />
        </div>
        {all && (
          <div className="space-y-1">
            <Label htmlFor="aar-status">Status</Label>
            <select id="aar-status" name="status" defaultValue={filters.status ?? ""} className={SELECT}>
              <option value="">Any status</option>
              {AAR_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_TEXT[s]}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="aar-mode">Mode</Label>
          <select id="aar-mode" name="mode" defaultValue={filters.mode ?? ""} className={SELECT}>
            <option value="">Any mode</option>
            {MODES.map((m) => (
              <option key={m} value={m}>
                {MODE_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="aar-from">Ended from</Label>
          <Input id="aar-from" name="from" type="date" defaultValue={filters.from ?? ""} className="w-auto" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="aar-to">Ended to</Label>
          <Input id="aar-to" name="to" type="date" defaultValue={filters.to ?? ""} className="w-auto" />
        </div>
        <Button type="submit" size="sm" className="h-9">
          Apply
        </Button>
        {hasFilters(filters) && (
          <Link href="/after-action-reports" className="inline-flex h-9 items-center px-2 text-sm font-medium text-[color:var(--mist-indigo)] hover:underline">
            Clear
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={FileCheck}
          title={hasFilters(filters) ? "No reports match." : all ? "No after-action reports yet." : "No final reports from your exercises yet."}
          description={hasFilters(filters) ? undefined : "A report starts after an exercise ends."}
        />
      ) : (
        <Card dense>
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[920px] text-[13px]" data-testid="aar-list">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.06em] text-[color:var(--color-muted-foreground)]">
                  <th className="py-1.5 pr-3 font-medium">Exercise</th>
                  <th className="py-1.5 pr-3 font-medium">Mode</th>
                  <th className="py-1.5 pr-3 font-medium">Ended</th>
                  <th className="py-1.5 pr-3 font-medium">Status</th>
                  <th className="py-1.5 pr-3 font-medium">Version</th>
                  <th className="py-1.5 pr-3 font-medium">Signers</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Accepted findings</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Work items</th>
                  <th className="py-1.5 font-medium">Export</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.aarId} className="border-t border-[color:var(--color-border)] align-top">
                    <td className="max-w-[280px] py-2 pr-3">
                      <Link href={`/exercises/${r.exerciseId}/aar`} className="font-medium text-[color:var(--mist-indigo)] hover:underline">
                        {r.exerciseTitle}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">{MODE_LABELS[r.mode as Mode] ?? r.mode}</td>
                    <td className="py-2 pr-3 font-mono tabular-nums">{day(r.endedAt)}</td>
                    <td className="py-2 pr-3">
                      <Badge variant={STATUS_VARIANT[r.status] ?? "secondary"}>{STATUS_TEXT[r.status] ?? r.status}</Badge>
                    </td>
                    <td className="py-2 pr-3 font-mono tabular-nums">v{r.version}</td>
                    <td className="py-2 pr-3">
                      {r.signers.length === 0 ? (
                        <span className="text-[color:var(--color-muted-foreground)]">None</span>
                      ) : (
                        r.signers.map((s) => (
                          <div key={s.role}>
                            {s.name} <span className="text-[color:var(--color-muted-foreground)]">{SIGNER_TEXT[s.role] ?? s.role}</span>
                          </div>
                        ))
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">{r.acceptedFindings}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">{r.workItems}</td>
                    <td className="py-2">
                      {r.status === "final" && r.canExport ? (
                        <span className="inline-flex gap-3">
                          <a href={`/api/exercises/${r.exerciseId}/aar/export?format=pdf&aarId=${r.aarId}`} className="font-medium text-[color:var(--mist-indigo)] hover:underline">
                            PDF
                          </a>
                          <a href={`/api/exercises/${r.exerciseId}/aar/export?format=bundle&aarId=${r.aarId}`} className="font-medium text-[color:var(--mist-indigo)] hover:underline">
                            Bundle
                          </a>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
