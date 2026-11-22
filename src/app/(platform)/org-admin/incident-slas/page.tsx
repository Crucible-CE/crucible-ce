"use client";

import { useCallback, useEffect, useState } from "react";
import { Timer, Loader2, Lock, Check, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";

type Matrix = Record<string, Record<string, number>>;
const MILESTONE_LABELS: Record<string, string> = { ack: "Acknowledge", contain: "Contain", resolve: "Resolve", first_update: "First update" };
const SEV_LABELS: Record<string, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

function humanize(min: number): string {
  if (min <= 0) return "off";
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${(min / 60).toFixed(min % 60 ? 1 : 0)}h`;
  return `${(min / 1440).toFixed(min % 1440 ? 1 : 0)}d`;
}

export default function IncidentSlasPage() {
  const confirm = useConfirm();
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [defaults, setDefaults] = useState<Matrix>({});
  const [severities, setSeverities] = useState<string[]>([]);
  const [milestones, setMilestones] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useUnsavedChangesGuard(dirty, { message: "You have unsaved changes." });

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/incident-slas");
    if (res.status === 403) { setForbidden(true); setLoading(false); return; }
    if (res.ok) { const d = await res.json(); setMatrix(d.matrix); setDefaults(d.defaults); setSeverities(d.severities); setMilestones(d.milestones); }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const setCell = (sev: string, ms: string, v: number) => {
    setMatrix((m) => (m ? { ...m, [sev]: { ...m[sev], [ms]: Math.max(0, v || 0) } } : m));
    setDirty(true);
  };

  const save = async () => {
    if (!matrix) return;
    setSaving(true);
    const entries = severities.flatMap((sev) => milestones.map((ms) => ({ severity: sev, milestone: ms, targetMinutes: matrix[sev]?.[ms] ?? 0 })));
    const res = await fetch("/api/admin/incident-slas", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entries }) });
    setSaving(false);
    if (res.ok) { setDirty(false); toast.success("SLAs saved"); } else toast.error("Couldn't save. Try again.");
  };

  if (loading) return <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (forbidden || !matrix) return (
    <div className="mx-auto max-w-lg rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-8 text-center">
      <Lock className="mx-auto h-8 w-8 text-muted-foreground" /><h2 className="mt-3 text-base font-semibold">Restricted</h2>
      <p className="mt-1 text-sm text-muted-foreground">Requires the <span className="font-mono">admin.access</span> permission.</p>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-24">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[color:var(--mist-indigo)]/15 text-[color:var(--mist-indigo)]"><Timer className="h-5 w-5" /></div>
        <div>
          <h1 className="text-lg font-semibold">Response SLAs</h1>
          <p className="text-sm text-muted-foreground">Target minutes for each severity. 0 turns a target off.</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[color:var(--color-border)] text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2">Severity</th>
              {milestones.map((ms) => <th key={ms} className="px-3 py-2 text-center">{MILESTONE_LABELS[ms] ?? ms}</th>)}
            </tr>
          </thead>
          <tbody>
            {severities.map((sev) => (
              <tr key={sev} className="border-b border-[color:var(--color-border)] last:border-0">
                <td className="px-4 py-2 font-medium">{SEV_LABELS[sev] ?? sev}</td>
                {milestones.map((ms) => (
                  <td key={ms} className="px-3 py-2 text-center">
                    <input type="number" min={0} value={matrix[sev]?.[ms] ?? 0} onChange={(e) => setCell(sev, ms, Number(e.target.value))}
                      className="w-20 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-1.5 py-1 text-right" />
                    <div className="mt-0.5 text-[10px] text-muted-foreground">{humanize(matrix[sev]?.[ms] ?? 0)}</div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button onClick={async () => { if (await confirm({ title: "Reset to defaults?", description: "Nothing changes until you save.", confirmLabel: "Reset", destructive: true })) { setMatrix(JSON.parse(JSON.stringify(defaults))); setDirty(true); } }} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
      </button>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-[color:var(--color-border)] bg-[color:var(--color-background)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-end px-4 py-3">
          <button onClick={save} disabled={!dirty || saving} className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--mist-indigo)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {saving ? "Saving…" : dirty ? "Save SLAs" : "Saved"}
          </button>
        </div>
      </div>
    </div>
  );
}
