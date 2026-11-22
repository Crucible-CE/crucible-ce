"use client";

import { useCallback, useEffect, useState } from "react";
import { Crosshair, Plus, Trash2, Download, Share2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { useIncidentShell } from "@/components/incident/incident-shell";
import { apiErrorMessage } from "@/lib/incident/lock-shared";

interface Indicator { id: string; indicatorType: string; value: string; status: string; source: string | null; note: string | null; sharedExternally: boolean }

const TYPES = ["ip", "domain", "url", "file_hash", "email", "account", "host", "other"];
const STATUS_STYLE: Record<string, string> = {
  active: "bg-[color:var(--mist-amber)]/15 text-[color:var(--mist-amber)]",
  blocked: "bg-[color:var(--mist-emerald)]/15 text-[color:var(--mist-emerald)]",
  false_positive: "bg-[color:var(--color-muted)] text-[color:var(--color-muted-foreground)]",
};

// Command-level Key Indicators — curated incident-defining IOCs for awareness,
// sharing (ISAC/CISA) and the case file. Not a tactical hunting TIP.
export function KeyIndicators({ incidentId }: { incidentId: string }) {
  const { readOnly } = useIncidentShell();
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ indicatorType: "ip", value: "", source: "", note: "" });

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch(`/api/incidents/${incidentId}/indicators`);
      if (res.ok) setIndicators((await res.json()).indicators);
      else setLoadError(true);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [incidentId]);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!form.value.trim()) return;
    const res = await fetch(`/api/incidents/${incidentId}/indicators`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (res.ok) { setForm({ indicatorType: "ip", value: "", source: "", note: "" }); setAdding(false); void load(); } else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't add indicator. Try again."));
  };
  const patch = async (iid: string, body: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/incidents/${incidentId}/indicators/${iid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't save indicator. Try again."));
    } catch {
      toast.error("Couldn't connect. Check your connection.");
    }
    void load();
  };
  // Soft-delete + undo toast: the row tombstones server-side; Undo
  // restores it within the toast window.
  const restore = async (iid: string) => {
    const res = await fetch(`/api/incidents/${incidentId}/indicators/${iid}/restore`, { method: "POST" });
    if (res.ok) toast.success("Indicator restored"); else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't restore indicator. Try again."));
    void load();
  };
  const del = async (iid: string) => {
    let res: Response;
    try {
      res = await fetch(`/api/incidents/${incidentId}/indicators/${iid}`, { method: "DELETE" });
    } catch {
      toast.error("Couldn't connect. Check your connection.");
      return;
    }
    if (!res.ok) { toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't delete indicator. Try again.")); return; }
    void load();
    toast.success("Indicator deleted", { action: { label: "Undo", onClick: () => void restore(iid) }, duration: 6000 });
  };

  return (
    <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Crosshair className="h-4 w-4 text-[color:var(--mist-indigo)]" /> Key indicators</h2>
        <div className="flex items-center gap-1.5">
          {indicators.length > 0 && (
            <a href={`/api/incidents/${incidentId}/indicators?export=csv`} className="inline-flex items-center gap-1 rounded-md border border-[color:var(--color-border)] px-2 py-1 text-xs text-muted-foreground hover:bg-[color:var(--color-muted)]"><Download className="h-3 w-3" /> CSV</a>
          )}
          {!readOnly && <button onClick={() => setAdding((a) => !a)} className="inline-flex items-center gap-1 rounded-md border border-[color:var(--color-border)] px-2 py-1 text-xs"><Plus className="h-3 w-3" /> Add</button>}
        </div>
      </div>

      {adding && !readOnly && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-background)] p-2.5">
          <select value={form.indicatorType} onChange={(e) => setForm({ ...form, indicatorType: e.target.value })} className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1.5 text-sm">
            {TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
          </select>
          <input value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="Indicator value" className="min-w-[160px] flex-1 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1.5 font-mono text-sm" />
          <input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="Source" className="w-24 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1.5 text-sm" />
          <button onClick={add} className="rounded-md bg-[color:var(--mist-indigo)] px-3 py-1.5 text-sm font-medium text-white">Add</button>
        </div>
      )}

      {loading && indicators.length === 0 ? (
        <div className="space-y-1">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : loadError && indicators.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Couldn&apos;t load indicators.</span>
          <button onClick={() => { setLoading(true); void load(); }} className="rounded-md border border-[color:var(--color-border)] px-2 py-1 text-xs hover:bg-[color:var(--color-muted)]">Retry</button>
        </div>
      ) : indicators.length === 0 ? <p className="text-xs text-muted-foreground">No indicators.</p> : (
        <div className="space-y-1">
          {indicators.map((i) => (
            <div key={i.id} className="flex items-center gap-2 rounded-md border border-[color:var(--color-border)] px-2.5 py-1.5">
              <span className="rounded bg-[color:var(--color-muted)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">{i.indicatorType.replace("_", " ")}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{i.value}</span>
              {i.sharedExternally && <Share2 className="h-3 w-3 text-[color:var(--mist-indigo)]" />}
              {readOnly ? (
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase", STATUS_STYLE[i.status])}>{i.status.replace("_", " ")}</span>
              ) : (
                <>
                  <select value={i.status} onChange={(e) => patch(i.id, { status: e.target.value })} className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase border-0", STATUS_STYLE[i.status])}>
                    <option value="active">active</option><option value="blocked">blocked</option><option value="false_positive">false positive</option>
                  </select>
                  <button onClick={() => patch(i.id, { sharedExternally: !i.sharedExternally })} title="Shared externally" aria-label="Toggle shared externally" className="text-muted-foreground hover:text-[color:var(--mist-indigo)]"><Share2 className="h-3.5 w-3.5" /></button>
                  <button onClick={() => del(i.id)} aria-label="Delete indicator" className="text-muted-foreground hover:text-[color:var(--mist-danger)]"><Trash2 className="h-3.5 w-3.5" /></button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
