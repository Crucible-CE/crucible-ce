"use client";

// Program report: exercises in a date window, cadence against policy, controls
// tested, required-role coverage, action items and remediation aging. PDF
// export of the full report and a one-page executive summary.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/components/exercise/api";

interface CadenceRow {
  framework: string;
  frameworkLabel: string;
  controlId: string | null;
  controlTitle: string | null;
  months: number;
  lastTested: string | null;
  dueAt: string | null;
  status: "current" | "due_soon" | "overdue" | "never";
  sentence: string;
}

interface Report {
  window: { from: string; to: string };
  exercises: Array<{ id: string; title: string; mode: string; endedAt: string | null; participants: number; aarStatus: string | null; aarVersion: number | null; openItems: number }>;
  lastTestedAt: string | null;
  controls: Array<{ framework: string; frameworkLabel: string; controlId: string; title: string; lastTested: string; result: "tested" | "gap" }>;
  cadence: CadenceRow[];
  roles: Array<{ role: string; present: number; total: number; lastPresentAt: string | null }>;
  actionItems: { open: number; overdue: number; openHigh: number; done: number; rejected: number; aging: Record<string, number> };
  findings?: { accepted: number; actionItems: number; noAction: number; rejected: number };
  overdueItems: Array<{ id: string; correctiveAction: string; poc: string | null; dueDate: string | null; priority: string; exerciseTitle: string | null }>;
  participantsInWindow: number;
  aarOverdue: Array<{ id: string; title: string; endedAt: string; days: number; missing: "draft" | "final" }>;
  signingKeys: Array<{ keyId: string; createdAt: string; retiredAt: string | null }>;
}

const CADENCE: Record<CadenceRow["status"], { label: string; variant: "success" | "warning" | "destructive" | "outline" }> = {
  current: { label: "Current", variant: "success" },
  due_soon: { label: "Due soon", variant: "warning" },
  overdue: { label: "Overdue", variant: "destructive" },
  never: { label: "Never tested", variant: "destructive" },
};
const MODE: Record<string, string> = { crisissim: "Crisis Sim", document: "Playbook Exercise", strategic: "Strategic TTX" };
const AGING = [
  { key: "0-30", label: "0 to 30 days" },
  { key: "31-60", label: "31 to 60 days" },
  { key: "61-90", label: "61 to 90 days" },
  { key: "90+", label: "Over 90 days" },
];

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">{label}</p>
      <p className="mt-0.5 font-display text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card dense className="gap-3">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {children}
    </Card>
  );
}

const th = "py-1.5 pr-3 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-[color:var(--color-muted-foreground)]";
const td = "py-2 pr-3 align-top";

export function ReportsClient() {
  const now = new Date();
  const yearAgo = new Date(now);
  yearAgo.setUTCFullYear(now.getUTCFullYear() - 1);
  const [from, setFrom] = useState(isoDay(yearAgo));
  const [to, setTo] = useState(isoDay(now));
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const load = useCallback(async () => {
    setLoading(true);
    const r = await api<Report>(`/api/reports/program?${q}`, { fallback: "The report did not load. Try again." });
    setLoading(false);
    if (r.ok) {
      setReport(r.data);
      setError(null);
    } else setError(r.error);
  }, [q]);

  useEffect(() => {
    void load();
    // Load once on mount; later loads come from the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <Card dense>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="rep-from">From</Label>
            <Input id="rep-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rep-to">To</Label>
            <Input id="rep-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
          </div>
          <Button type="submit" size="sm" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Show
          </Button>
          <span className="flex-1" />
          <a href={`/api/reports/program?${q}&format=pdf`} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium hover:bg-[color:var(--color-muted)]">
            <Download className="h-4 w-4" />
            Program report PDF
          </a>
          <a href={`/api/reports/summary?${q}`} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium hover:bg-[color:var(--color-muted)]">
            <Download className="h-4 w-4" />
            Executive summary PDF
          </a>
        </form>
      </Card>

      {error && (
        <p role="alert" className="text-[13px] text-[color:var(--mist-danger)]">
          {error}
        </p>
      )}
      {!report && !error && (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-[color:var(--color-muted-foreground)]" />
        </div>
      )}

      {report && (
        <>
          <Card dense>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Last exercise" value={day(report.lastTestedAt) || "None"} />
              <Stat label="Exercises" value={String(report.exercises.length)} />
              <Stat label="Participants" value={String(report.participantsInWindow)} />
              <Stat label="Open items" value={String(report.actionItems.open)} />
              <Stat label="Overdue" value={String(report.actionItems.overdue)} />
              <Stat label="Open high" value={String(report.actionItems.openHigh)} />
            </div>
            {report.findings && (
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4" data-testid="program-findings">
                <Stat label="Accepted findings" value={String(report.findings.accepted)} />
                <Stat label="With a work item" value={String(report.findings.actionItems)} />
                <Stat label="No action needed" value={String(report.findings.noAction)} />
                <Stat label="Rejected findings" value={String(report.findings.rejected)} />
              </div>
            )}
          </Card>

          <Section title="Reports past due">
            {report.aarOverdue.length === 0 ? (
              <p className="text-[13px] text-[color:var(--color-muted-foreground)]">No report is past due.</p>
            ) : (
              <ul className="space-y-1 text-[13px]" data-testid="aar-overdue">
                {report.aarOverdue.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/exercises/${x.id}/aar`} className="font-medium text-[color:var(--mist-indigo)] hover:underline">
                      {x.title}
                    </Link>
                    <Badge variant="warning">{x.missing === "draft" ? "No draft after 30 days" : "No final after 90 days"}</Badge>
                    <span className="text-[color:var(--color-muted-foreground)]">Ended {x.endedAt.slice(0, 10)}, {x.days} days ago</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Cadence">
            {report.cadence.length === 0 ? (
              <p className="text-[13px] text-[color:var(--color-muted-foreground)]">Enable a framework with a cadence in settings.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-[13px]">
                  <thead>
                    <tr>
                      <th className={th}>Requirement</th>
                      <th className={th}>Every</th>
                      <th className={th}>Last tested</th>
                      <th className={th}>Due</th>
                      <th className={th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.cadence.map((c) => (
                      <tr key={`${c.framework}|${c.controlId}`} className="border-t border-[color:var(--color-border)]">
                        <td className={td}>
                          {c.frameworkLabel} {c.controlId}
                          {c.controlTitle && <span className="block text-[12px] text-[color:var(--color-muted-foreground)]">{c.controlTitle}</span>}
                        </td>
                        <td className={td}>{c.months} months</td>
                        <td className={`${td} font-mono tabular-nums`}>{day(c.lastTested) || "Never"}</td>
                        <td className={`${td} font-mono tabular-nums`}>{day(c.dueAt)}</td>
                        <td className={td}>
                          <Badge variant={CADENCE[c.status].variant}>{CADENCE[c.status].label}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="Exercises">
            {report.exercises.length === 0 ? (
              <p className="text-[13px] text-[color:var(--color-muted-foreground)]">No exercises ended in this window. Practice runs are left out.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-[13px]">
                  <thead>
                    <tr>
                      <th className={th}>Exercise</th>
                      <th className={th}>Type</th>
                      <th className={th}>Ended</th>
                      <th className={th}>Participants</th>
                      <th className={th}>Report</th>
                      <th className={th}>Open items</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.exercises.map((e) => (
                      <tr key={e.id} className="border-t border-[color:var(--color-border)]">
                        <td className={td}>
                          <Link href={`/exercises/${e.id}`} className="text-[color:var(--mist-indigo)] hover:underline">
                            {e.title}
                          </Link>
                        </td>
                        <td className={td}>{MODE[e.mode] ?? e.mode}</td>
                        <td className={`${td} font-mono tabular-nums`}>{day(e.endedAt)}</td>
                        <td className={`${td} tabular-nums`}>{e.participants}</td>
                        <td className={td}>{e.aarStatus ? `${e.aarStatus === "final" ? "Final" : e.aarStatus === "review" ? "In review" : "Draft"} v${e.aarVersion}` : "None"}</td>
                        <td className={`${td} tabular-nums`}>{e.openItems}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Controls tested">
              {report.controls.length === 0 ? (
                <p className="text-[13px] text-[color:var(--color-muted-foreground)]">No final report maps controls of the enabled frameworks.</p>
              ) : (
                <ul className="space-y-1 text-[13px]">
                  {report.controls.map((c) => (
                    <li key={`${c.framework}|${c.controlId}`} className="flex flex-wrap items-baseline gap-2">
                      <span className="font-medium">
                        {c.frameworkLabel} {c.controlId}
                      </span>
                      <span className="min-w-0 flex-1 text-[color:var(--color-muted-foreground)]">{c.title}</span>
                      <span className="font-mono text-[12px] tabular-nums">{day(c.lastTested)}</span>
                      {c.result === "gap" && <Badge variant="warning">Gap</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Required roles, last 12 months">
              {report.roles.length === 0 ? (
                <p className="text-[13px] text-[color:var(--color-muted-foreground)]">Set required roles in settings.</p>
              ) : (
                <ul className="space-y-1 text-[13px]">
                  {report.roles.map((r) => (
                    <li key={r.role} className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 font-medium">{r.role}</span>
                      <span className="tabular-nums">
                        {r.present} of {r.total}
                      </span>
                      {r.present === 0 && <Badge variant="destructive">Absent</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          <Section title="Remediation aging">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {AGING.map((b) => (
                <Stat key={b.key} label={b.label} value={String(report.actionItems.aging[b.key] ?? 0)} />
              ))}
            </div>
            {report.overdueItems.length > 0 && (
              <ul className="space-y-1 text-[13px]">
                {report.overdueItems.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-baseline gap-2">
                    <span className="min-w-0 flex-1">{i.correctiveAction}</span>
                    <span className="text-[color:var(--color-muted-foreground)]">{i.poc}</span>
                    <span className="font-mono text-[12px] tabular-nums text-[color:var(--mist-danger)]">{day(i.dueDate)}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/action-items" className="text-[13px] font-medium text-[color:var(--mist-indigo)] hover:underline">
              Open work items
            </Link>
          </Section>

          <Section title="Signing keys">
            {report.signingKeys.length === 0 ? (
              <p className="text-[13px] text-[color:var(--color-muted-foreground)]">No signing key is registered yet.</p>
            ) : (
              <ul className="space-y-1 text-[13px]">
                {report.signingKeys.map((k) => (
                  <li key={k.keyId}>
                    <span className="font-mono">{k.keyId}</span>{" "}
                    <span className="text-[color:var(--color-muted-foreground)]">
                      added {k.createdAt.slice(0, 10)}
                      {k.retiredAt ? `, retired ${k.retiredAt.slice(0, 10)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
