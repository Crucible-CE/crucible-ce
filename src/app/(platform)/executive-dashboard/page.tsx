import Link from "next/link";
import { redirect } from "next/navigation";
import { Download, PieChart } from "lucide-react";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { ceRoleFor, hasPermission } from "@/lib/exercise/auth/rbac";
import { buildExecutiveDashboard, minutesText, SEVERITIES } from "@/lib/exercise/program/executive";
import { AGING_BUCKETS } from "@/lib/exercise/program/report";
import { MODE_TEXT } from "@/lib/exercise/aar/labels";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CloudSeam } from "@/components/cloud/cloud-seam";
import { ReadinessTrend } from "@/components/reports/readiness-trend";

export const dynamic = "force-dynamic";

const CADENCE: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "outline" }> = {
  current: { label: "Current", variant: "success" },
  due_soon: { label: "Due soon", variant: "warning" },
  overdue: { label: "Overdue", variant: "destructive" },
  never: { label: "Never tested", variant: "outline" },
};
const SEVERITY_TEXT: Record<string, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

function Stat({ label, value, href }: { label: string; value: string; href?: string }) {
  const body = (
    <>
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">{label}</p>
      <p className="mt-0.5 font-display text-2xl font-semibold tabular-nums">{value}</p>
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-md hover:bg-[color:var(--color-muted)]">
      {body}
    </Link>
  ) : (
    <div>{body}</div>
  );
}

function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <Card dense className="gap-3" data-testid={testId}>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {children}
    </Card>
  );
}

const muted = "text-[13px] text-[color:var(--color-muted-foreground)]";

export default async function ExecutiveDashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!hasPermission(user, "reports.view")) {
    return (
      <>
        <PageHeader title="Executive dashboard" />
        <EmptyState icon={PieChart} title="Readers do not see the executive dashboard." />
      </>
    );
  }
  const d = await buildExecutiveDashboard({ id: user.id, organizationId: user.organizationId, role: ceRoleFor(user.role) });
  const r = d.readiness;

  return (
    <>
      <PageHeader
        title="Executive dashboard"
        description="Readiness, incidents, the exercise program and the improvement plan."
        action={
          <a
            href="/api/executive-dashboard?format=pdf"
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium hover:bg-[color:var(--color-muted)]"
          >
            <Download className="h-4 w-4" />
            PDF
          </a>
        }
      />
      <div className="space-y-4">
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.4fr]">
          <Section title="Readiness score" testId="readiness-score">
            <p className="font-display text-5xl font-semibold tabular-nums text-[color:var(--mist-ready-text)]">
              {r.score}
              <span className="ml-1 text-base font-normal text-[color:var(--color-muted-foreground)]">of 100</span>
            </p>
            <ul className="space-y-2.5" data-testid="readiness-components">
              {r.components.map((c) => (
                <li key={c.key} className="text-[13px]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{c.label}</span>
                    <span className="tabular-nums text-[color:var(--color-muted-foreground)]">
                      {c.score === null ? "Not counted" : `${c.score}, weight ${c.weight}`}
                    </span>
                  </div>
                  <div className="readiness-track mt-1 h-1.5 overflow-hidden">
                    <div className="readiness-seg h-full" style={{ width: `${c.score ?? 0}%` }} />
                  </div>
                  <p className="mt-0.5 text-[12px] text-[color:var(--color-muted-foreground)]">{c.explanation}</p>
                </li>
              ))}
            </ul>
            <CloudSeam feature="document-analysis" />
          </Section>
          <Section title="Readiness, last 12 months">
            <ReadinessTrend points={d.trend} now={d.generatedAt} />
            <p className={muted}>One snapshot a night. The score is rule-based and incidents do not change it.</p>
          </Section>
        </section>

        <Section title="Incidents" testId="exec-incidents">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Open" value={String(d.incidents.open)} href="/incidents" />
            <Stat label="Past an SLA" value={String(d.incidents.slaBreached)} />
            <Stat label={`MTTA, ${d.incidents.windowDays} days`} value={minutesText(d.incidents.mttaMinutes)} />
            <Stat label={`MTTR, ${d.incidents.windowDays} days`} value={minutesText(d.incidents.mttrMinutes)} />
          </div>
          <div className="flex flex-wrap gap-2">
            {SEVERITIES.map((s) => (
              <Badge key={s} variant="outline">
                {SEVERITY_TEXT[s]} {d.incidents.bySeverity[s] ?? 0}
              </Badge>
            ))}
          </div>
        </Section>

        <Section title="Exercise program" testId="exec-program">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Last exercise" value={d.program.lastExerciseAt?.slice(0, 10) ?? "None"} />
            <Stat label="Exercises, 12 months" value={String(d.program.exercises)} href="/reports" />
            {Object.keys(MODE_TEXT).map((m) => (
              <Stat key={m} label={MODE_TEXT[m]} value={String(d.program.byMode[m] ?? 0)} />
            ))}
          </div>
          {d.program.cadence.length === 0 ? (
            <p className={muted}>No cadence set for the enabled frameworks.</p>
          ) : (
            <ul className="space-y-1 text-[13px]">
              {d.program.cadence.map((c) => (
                <li key={`${c.framework}:${c.controlId ?? ""}`} className="flex flex-wrap items-center gap-2">
                  <Badge variant={CADENCE[c.status]?.variant ?? "outline"}>{CADENCE[c.status]?.label ?? c.status}</Badge>
                  <span>{c.sentence}</span>
                </li>
              ))}
            </ul>
          )}
          {d.program.roles.length ? (
            <ul className="flex flex-wrap gap-2 text-[13px]">
              {d.program.roles.map((x) => (
                <li key={x.role}>
                  <Badge variant={x.total > 0 && x.present === x.total ? "success" : "outline"}>
                    {x.role} {x.present} of {x.total}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className={muted}>No required roles set in policy.</p>
          )}
        </Section>

        <Section title="Improvement plan" testId="exec-improvement">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Open items" value={String(d.improvement.open)} href="/action-items" />
            <Stat label="Overdue" value={String(d.improvement.overdue)} />
            <Stat label="Open high" value={String(d.improvement.openHigh)} />
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {AGING_BUCKETS.map((b) => (
              <Stat key={b.key} label={b.label} value={String(d.improvement.aging[b.key] ?? 0)} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Accepted findings" value={String(d.improvement.findings.accepted)} />
            <Stat label="With a work item" value={String(d.improvement.findings.actionItems)} />
            <Stat label="No action needed" value={String(d.improvement.findings.noAction)} />
          </div>
        </Section>
      </div>
    </>
  );
}
