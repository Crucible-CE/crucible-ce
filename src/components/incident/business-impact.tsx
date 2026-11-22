"use client";

import { useCallback, useEffect, useState } from "react";
import { TrendingDown, Pencil, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useIncidentShell } from "./incident-shell";
import { apiErrorMessage } from "@/lib/incident/lock-shared";

interface Impact {
  recordsAffected: number | null; customersAffected: number | null;
  downtimeMinutes: number | null; estimatedCostUsd: number | null; impactDataTypesJson: string[] | null;
}

function fmt(n: number | null): string { return n == null ? "Not set" : n.toLocaleString(); }
function dur(min: number | null): string { return min == null ? "Not set" : min < 60 ? `${min}m` : min < 1440 ? `${(min / 60).toFixed(1)}h` : `${(min / 1440).toFixed(1)}d`; }

export function BusinessImpact({ incidentId }: { incidentId: string }) {
  const [d, setD] = useState<Impact | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Impact>({ recordsAffected: null, customersAffected: null, downtimeMinutes: null, estimatedCostUsd: null, impactDataTypesJson: null });
  const [dataTypes, setDataTypes] = useState("");
  const [saving, setSaving] = useState(false);
  const { readOnly } = useIncidentShell();

  const load = useCallback(async () => {
    const res = await fetch(`/api/incidents/${incidentId}`);
    if (res.ok) {
      const i = await res.json();
      setD({ recordsAffected: i.recordsAffected ?? null, customersAffected: i.customersAffected ?? null, downtimeMinutes: i.downtimeMinutes ?? null, estimatedCostUsd: i.estimatedCostUsd ?? null, impactDataTypesJson: i.impactDataTypesJson ?? null });
    }
  }, [incidentId]);
  useEffect(() => { void load(); }, [load]);

  const startEdit = () => { if (!d) return; setDraft(d); setDataTypes((d.impactDataTypesJson ?? []).join(", ")); setEditing(true); };
  const save = async () => {
    setSaving(true);
    const body = {
      recordsAffected: draft.recordsAffected, customersAffected: draft.customersAffected,
      downtimeMinutes: draft.downtimeMinutes, estimatedCostUsd: draft.estimatedCostUsd,
      impactDataTypesJson: dataTypes.trim() ? dataTypes.split(",").map((s) => s.trim()).filter(Boolean) : [],
    };
    const res = await fetch(`/api/incidents/${incidentId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSaving(false);
    if (res.ok) { setEditing(false); toast.success("Impact updated"); void load(); } else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't save. Try again."));
  };

  if (!d) return null;
  const num = (label: string, key: keyof Impact, prefix = "") => (
    <label className="block text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input type="number" min={0} value={(draft[key] as number | null) ?? ""} onChange={(e) => setDraft({ ...draft, [key]: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
        placeholder={prefix} className="mt-0.5 w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1 text-sm" />
    </label>
  );

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground"><TrendingDown className="h-3.5 w-3.5" /> Business impact</h3>
        {!editing && !readOnly && <button onClick={startEdit} aria-label="Edit business impact" className="text-muted-foreground hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>}
      </div>
      {editing && !readOnly ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {num("Records affected", "recordsAffected")}
            {num("Customers affected", "customersAffected")}
            {num("Downtime (min)", "downtimeMinutes")}
            {num("Est. cost (USD)", "estimatedCostUsd")}
          </div>
          <label className="block text-xs">
            <span className="text-muted-foreground">Data types (comma-separated, e.g. PII, PHI)</span>
            <input value={dataTypes} onChange={(e) => setDataTypes(e.target.value)} className="mt-0.5 w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1 text-sm" />
          </label>
          <div className="flex justify-end gap-1.5">
            <button onClick={() => setEditing(false)} className="rounded border border-[color:var(--color-border)] px-2 py-1 text-xs">Cancel</button>
            <button onClick={save} disabled={saving} className="inline-flex items-center gap-1 rounded bg-[color:var(--mist-indigo)] px-2 py-1 text-xs font-medium text-white">{saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save</button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div><div className="text-muted-foreground">Records</div><div className="font-semibold">{fmt(d.recordsAffected)}</div></div>
          <div><div className="text-muted-foreground">Customers</div><div className="font-semibold">{fmt(d.customersAffected)}</div></div>
          <div><div className="text-muted-foreground">Downtime</div><div className="font-semibold">{dur(d.downtimeMinutes)}</div></div>
          <div><div className="text-muted-foreground">Est. cost</div><div className="font-semibold">{d.estimatedCostUsd == null ? "Not set" : `$${d.estimatedCostUsd.toLocaleString()}`}</div></div>
          {d.impactDataTypesJson && d.impactDataTypesJson.length > 0 && (
            <div className="col-span-2"><div className="text-muted-foreground">Data types</div><div className="font-medium">{d.impactDataTypesJson.join(", ")}</div></div>
          )}
        </div>
      )}
    </div>
  );
}
