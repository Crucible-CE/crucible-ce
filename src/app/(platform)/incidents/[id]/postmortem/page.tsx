"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  ClipboardCheck, Save, Loader2, Plus, X, Lock, ShieldCheck,
  Clock, Gauge, ListChecks, AlertOctagon, ThumbsUp, ThumbsDown, BookOpen,
} from "lucide-react";
import { CorrectiveActions } from "@/components/incident/corrective-actions";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useIncidentShell } from "@/components/incident/incident-shell";
import { apiErrorMessage } from "@/lib/incident/lock-shared";
import { CloudSeam } from "@/components/cloud/cloud-seam";
import { toDatetimeLocalValue, toIsoOrNull, toDateInputValue, fromDateInputValue } from "@/lib/datetime/local";

interface Factor { factor: string; category: string }
interface ActionItem { title: string; owner: string; dueAt: string | null; status: string }
interface TimelineRow { at: string; label: string }
interface Metrics { mttdMinutes: number | null; containmentMinutes: number | null; mttrMinutes: number | null; dwellMinutes: number | null }
interface Impact { systems: string; customersAffected: string; dataRecords: string; financial: string; regulatory: string; notes: string }

const FACTOR_CATS = ["process", "technical", "human", "external", "detection"];
const EMPTY_IMPACT: Impact = { systems: "", customersAffected: "", dataRecords: "", financial: "", regulatory: "", notes: "" };
const EMPTY_METRICS: Metrics = { mttdMinutes: null, containmentMinutes: null, mttrMinutes: null, dwellMinutes: null };

function fmtDuration(min: number | null): string {
  if (min === null || min === undefined) return "not set";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return `${h}h${m ? ` ${m}m` : ""}`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export default function PostmortemPage() {
  const { id: incidentId } = useParams<{ id: string }>();
  const confirm = useConfirm();
  const { readOnly } = useIncidentShell();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [status, setStatus] = useState("draft");
  const [summary, setSummary] = useState("");
  const [startAt, setStartAt] = useState("");
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [impact, setImpact] = useState<Impact>(EMPTY_IMPACT);
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [wentWell, setWentWell] = useState<string[]>([]);
  const [wentPoorly, setWentPoorly] = useState<string[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [lessons, setLessons] = useState("");

  const [suggested, setSuggested] = useState<Metrics>(EMPTY_METRICS);
  const [timelineSeed, setTimelineSeed] = useState<TimelineRow[]>([]);

  const finalized = status === "final";

  const load = useCallback(async () => {
    const res = await fetch(`/api/incidents/${incidentId}/postmortem`);
    if (res.ok) {
      const d = await res.json();
      setSuggested(d.suggestedMetrics ?? EMPTY_METRICS);
      setTimelineSeed((d.timelineSeed ?? []).map((t: TimelineRow) => ({ at: t.at, label: t.label })));
      const pm = d.postmortem;
      if (pm) {
        setStatus(pm.status ?? "draft");
        setSummary(pm.summary ?? "");
        setStartAt(toDatetimeLocalValue(pm.incidentStartAt));
        setMetrics({ ...EMPTY_METRICS, ...(pm.metricsJson ?? {}) });
        setImpact({ ...EMPTY_IMPACT, ...(pm.impactJson ?? {}) });
        setTimeline(pm.timelineJson ?? []);
        setFactors(pm.contributingFactorsJson ?? []);
        setWentWell(pm.wentWellJson ?? []);
        setWentPoorly(pm.wentPoorlyJson ?? []);
        setActions(pm.actionItemsJson ?? []);
        setLessons(pm.lessonsLearned ?? "");
      }
    }
    setLoading(false);
  }, [incidentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const buildBody = (overrideStatus?: string) => ({
    status: overrideStatus ?? status,
    summary,
    incidentStartAt: toIsoOrNull(startAt),
    metricsJson: metrics,
    impactJson: impact,
    timelineJson: timeline,
    contributingFactorsJson: factors,
    wentWellJson: wentWell,
    wentPoorlyJson: wentPoorly,
    actionItemsJson: actions,
    lessonsLearned: lessons,
  });

  const save = async (overrideStatus?: string) => {
    setSaving(true);
    const res = await fetch(`/api/incidents/${incidentId}/postmortem`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildBody(overrideStatus)),
    });
    setSaving(false);
    if (res.ok) {
      const pm = await res.json();
      setStatus(pm.status);
      toast.success(overrideStatus === "final" ? "Postmortem finalized" : "Saved");
    } else {
      toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't save. Try again."));
    }
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[color:var(--color-muted-foreground)]" /></div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-12">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-[color:var(--mist-indigo)]" />
          <div>
            <h1 className="text-base font-semibold">Postmortem</h1>
            <p className="text-[11.5px] text-[color:var(--color-muted-foreground)]">Blameless review. Focus on systems, not people.</p>
          </div>
          <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${finalized ? "bg-[color:var(--mist-success)]/15 text-[color:var(--mist-success)]" : "bg-[color:var(--mist-amber)]/15 text-[color:var(--mist-amber)]"}`}>
            {status.replace("_", " ")}
          </span>
        </div>
        {!readOnly && <div className="flex items-center gap-2">
          <button onClick={() => save()} disabled={saving || finalized} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[color:var(--mist-indigo)] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
          </button>
          {!finalized && (
            <button onClick={async () => { const ok = await confirm({ title: "Finalize this postmortem?", description: "It becomes read-only.", confirmLabel: "Finalize" }); if (ok) void save("final"); }} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[color:var(--mist-success)]/40 px-3 py-1.5 text-[12px] font-medium text-[color:var(--mist-success)] hover:bg-[color:var(--mist-success)]/10">
              <Lock className="h-3.5 w-3.5" /> Finalize
            </button>
          )}
        </div>}
      </div>

      {!readOnly && !finalized && <CloudSeam feature="postmortem-drafting" />}
      <fieldset disabled={finalized || readOnly} className="space-y-5">
        {/* Summary */}
        <Section icon={ShieldCheck} title="Executive summary">
          <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} placeholder="What happened and the outcome" className="w-full resize-y rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-transparent px-3 py-2 text-[13px] outline-none focus:border-[color:var(--mist-indigo)]/50" />
        </Section>

        {/* Metrics */}
        <Section icon={Gauge} title="Response metrics" action={
          <button onClick={() => setMetrics(suggested)} className="text-[11px] text-[color:var(--mist-indigo)] hover:underline">Use suggested</button>
        }>
          <div className="mb-3 flex items-center gap-2">
            <label className="text-[11px] text-[color:var(--color-muted-foreground)]">Activity began</label>
            <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className="rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-[12px]" />
            <span className="text-[10.5px] text-[color:var(--color-muted-foreground)]">(for dwell time and MTTD)</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([
              ["mttdMinutes", "MTTD (detect)"],
              ["containmentMinutes", "Containment"],
              ["mttrMinutes", "MTTR (resolve)"],
              ["dwellMinutes", "Dwell time"],
            ] as const).map(([key, label]) => (
              <div key={key} className="rounded-[var(--radius-sm)] border border-[color:var(--color-border)] p-2">
                <p className="text-[10px] uppercase text-[color:var(--color-muted-foreground)]">{label}</p>
                <input
                  type="number"
                  min={0}
                  value={metrics[key] ?? ""}
                  onChange={(e) => setMetrics({ ...metrics, [key]: e.target.value === "" ? null : Number(e.target.value) })}
                  placeholder={suggested[key] !== null ? String(suggested[key]) : "0"}
                  className="w-full bg-transparent text-[15px] font-semibold outline-none"
                />
                <p className="text-[10px] text-[color:var(--color-muted-foreground)]">min · {fmtDuration(metrics[key])}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Impact */}
        <Section icon={AlertOctagon} title="Impact assessment">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Affected systems/services" value={impact.systems} onChange={(v) => setImpact({ ...impact, systems: v })} />
            <Field label="Customers affected" value={impact.customersAffected} onChange={(v) => setImpact({ ...impact, customersAffected: v })} />
            <Field label="Data / records exposed" value={impact.dataRecords} onChange={(v) => setImpact({ ...impact, dataRecords: v })} />
            <Field label="Financial impact" value={impact.financial} onChange={(v) => setImpact({ ...impact, financial: v })} />
            <Field label="Regulatory exposure" value={impact.regulatory} onChange={(v) => setImpact({ ...impact, regulatory: v })} />
            <Field label="Notes" value={impact.notes} onChange={(v) => setImpact({ ...impact, notes: v })} />
          </div>
        </Section>

        {/* Timeline */}
        <Section icon={Clock} title="Timeline" action={
          timelineSeed.length > 0 && <button onClick={() => setTimeline(timelineSeed)} className="text-[11px] text-[color:var(--mist-indigo)] hover:underline">Seed from incident</button>
        }>
          <div className="space-y-2">
            {timeline.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="datetime-local" value={toDatetimeLocalValue(t.at)} onChange={(e) => { const c = [...timeline]; c[i] = { ...t, at: toIsoOrNull(e.target.value) ?? "" }; setTimeline(c); }} className="rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-[12px]" />
                <input value={t.label} onChange={(e) => { const c = [...timeline]; c[i] = { ...t, label: e.target.value }; setTimeline(c); }} placeholder="What happened" className="flex-1 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-[13px]" />
                <button onClick={() => setTimeline(timeline.filter((_, j) => j !== i))} className="text-[color:var(--color-muted-foreground)] hover:text-[color:var(--mist-danger)]"><X className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            <AddRow label="Add timeline entry" onClick={() => setTimeline([...timeline, { at: new Date().toISOString(), label: "" }])} />
          </div>
        </Section>

        {/* Contributing factors */}
        <Section icon={ListChecks} title="Contributing factors" subtitle="What conditions led here, not who.">
          <div className="space-y-2">
            {factors.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <select value={f.category} onChange={(e) => { const c = [...factors]; c[i] = { ...f, category: e.target.value }; setFactors(c); }} className="rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-[12px] capitalize">
                  {FACTOR_CATS.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                </select>
                <input value={f.factor} onChange={(e) => { const c = [...factors]; c[i] = { ...f, factor: e.target.value }; setFactors(c); }} placeholder="Contributing factor" className="flex-1 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-[13px]" />
                <button onClick={() => setFactors(factors.filter((_, j) => j !== i))} className="text-[color:var(--color-muted-foreground)] hover:text-[color:var(--mist-danger)]"><X className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            <AddRow label="Add factor" onClick={() => setFactors([...factors, { factor: "", category: "process" }])} />
          </div>
        </Section>

        {/* Went well / poorly */}
        <div className="grid gap-5 sm:grid-cols-2">
          <Section icon={ThumbsUp} title="What went well">
            <ListEditor items={wentWell} onChange={setWentWell} placeholder="Something that worked" />
          </Section>
          <Section icon={ThumbsDown} title="What went poorly">
            <ListEditor items={wentPoorly} onChange={setWentPoorly} placeholder="Something that slowed the response" />
          </Section>
        </div>

        {/* Work items */}
        <Section icon={ListChecks} title="Work items" subtitle="Each with an owner and due date.">
          <div className="space-y-2">
            {actions.map((a, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] p-2">
                <input value={a.title} onChange={(e) => { const c = [...actions]; c[i] = { ...a, title: e.target.value }; setActions(c); }} placeholder="Action" className="min-w-[180px] flex-1 bg-transparent text-[13px] outline-none" />
                <input value={a.owner} onChange={(e) => { const c = [...actions]; c[i] = { ...a, owner: e.target.value }; setActions(c); }} placeholder="Owner" className="w-28 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-[12px]" />
                <input type="date" value={toDateInputValue(a.dueAt)} onChange={(e) => { const c = [...actions]; c[i] = { ...a, dueAt: fromDateInputValue(e.target.value)?.toISOString() ?? null }; setActions(c); }} className="rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-[12px]" />
                <select value={a.status} onChange={(e) => { const c = [...actions]; c[i] = { ...a, status: e.target.value }; setActions(c); }} className="rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-[12px]">
                  <option value="open">Open</option>
                  <option value="in_progress">In progress</option>
                  <option value="done">Done</option>
                </select>
                <button onClick={() => setActions(actions.filter((_, j) => j !== i))} className="text-[color:var(--color-muted-foreground)] hover:text-[color:var(--mist-danger)]"><X className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            <AddRow label="Add work item" onClick={() => setActions([...actions, { title: "", owner: "", dueAt: null, status: "open" }])} />
          </div>
        </Section>

        {/* Lessons */}
        <Section icon={BookOpen} title="Lessons learned">
          <textarea value={lessons} onChange={(e) => setLessons(e.target.value)} rows={4} placeholder="Key takeaways" className="w-full resize-y rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-transparent px-3 py-2 text-[13px] outline-none focus:border-[color:var(--mist-indigo)]/50" />
        </Section>
      </fieldset>

      {finalized && (
        <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-[color:var(--color-muted-foreground)]">
          <Lock className="h-3 w-3" /> Finalized. Read-only.
        </p>
      )}

      <CorrectiveActions incidentId={incidentId} />
    </div>
  );
}

function Section({ icon: Icon, title, subtitle, action, children }: { icon: React.ElementType; title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-[color:var(--mist-indigo)]" />
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && <span className="text-[11px] text-[color:var(--color-muted-foreground)]">{subtitle}</span>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase text-[color:var(--color-muted-foreground)]">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="mt-0.5 w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-transparent px-2 py-1.5 text-[13px] outline-none focus:border-[color:var(--mist-indigo)]/50" />
    </label>
  );
}

function ListEditor({ items, onChange, placeholder }: { items: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2">
          <input value={it} onChange={(e) => { const c = [...items]; c[i] = e.target.value; onChange(c); }} placeholder={placeholder} className="flex-1 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-[13px]" />
          <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-[color:var(--color-muted-foreground)] hover:text-[color:var(--mist-danger)]"><X className="h-3.5 w-3.5" /></button>
        </div>
      ))}
      <AddRow label="Add" onClick={() => onChange([...items, ""])} />
    </div>
  );
}

function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1 text-[12px] text-[color:var(--mist-indigo)] hover:underline">
      <Plus className="h-3.5 w-3.5" /> {label}
    </button>
  );
}
