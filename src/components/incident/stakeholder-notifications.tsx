"use client";

import { useCallback, useEffect, useState } from "react";
import { Users2, Plus, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { AssignUserModal } from "@/components/incident/assign-user-modal";
import { useIncidentShell } from "@/components/incident/incident-shell";
import { apiErrorMessage } from "@/lib/incident/lock-shared";
import { CloudSeam } from "@/components/cloud/cloud-seam";

// Stakeholder notification tracker. Extracted into a component so it can live in
// the Comms tab (Stakeholders merged into Comms) and still back its own route.

interface Stakeholder {
  id: string;
  stakeholder: string;
  channel: string | null;
  status: string;
  notes: string | null;
  notifiedAt: string | null;
}

const PRESETS = ["Board", "Executive Team", "Customers", "Cyber Insurer", "Breach Counsel", "Law Enforcement", "Regulator", "Key Partners"];
const STATUS_OPTIONS = ["pending", "notified", "acknowledged", "not_required"] as const;
const STATUS_CLASS: Record<string, string> = {
  pending: "text-[color:var(--mist-warn)]",
  notified: "text-[color:var(--mist-indigo)]",
  acknowledged: "text-[color:var(--mist-ok)]",
  not_required: "text-[color:var(--color-muted-foreground)]",
};

export function StakeholderNotifications({ incidentId }: { incidentId: string }) {
  const { readOnly } = useIncidentShell();
  const [items, setItems] = useState<Stakeholder[]>([]);
  const [loading, setLoading] = useState(true);
  const [custom, setCustom] = useState("");
  const [adding, setAdding] = useState(false);
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/incidents/${incidentId}/stakeholders`);
    if (res.ok) setItems((await res.json()).stakeholders ?? []);
    setLoading(false);
  }, [incidentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (stakeholder: string, userId?: string) => {
    if (!stakeholder.trim()) return;
    setAdding(true);
    const res = await fetch(`/api/incidents/${incidentId}/stakeholders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stakeholder: stakeholder.trim(), userId }),
    });
    setAdding(false);
    if (res.ok) {
      setCustom("");
      await load();
    } else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't add. Try again."));
  };

  const setStatus = async (notificationId: string, status: string) => {
    const res = await fetch(`/api/incidents/${incidentId}/stakeholders/${notificationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) await load();
    else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't update. Try again."));
  };

  const tracked = new Set(items.map((i) => i.stakeholder.toLowerCase()));

  return (
    <div className={`grid gap-4 ${readOnly ? "" : "lg:grid-cols-[1fr_260px]"}`}>
      <section className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
        <div className="mb-3 flex items-center gap-2">
          <Users2 className="h-4 w-4 text-[color:var(--mist-indigo)]" />
          <h2 className="text-sm font-semibold">Stakeholder notifications</h2>
        </div>
        {!readOnly && <CloudSeam feature="comms-drafting" className="mb-3" />}
        {loading ? (
          <div className="py-6 text-center text-xs text-[color:var(--color-muted-foreground)]">Loading…</div>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-xs text-[color:var(--color-muted-foreground)]">No stakeholders tracked yet.{!readOnly && " Add from the list on the right."}</p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border)] p-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{s.stakeholder}</p>
                  <p className="text-[10.5px] text-[color:var(--color-muted-foreground)]">{s.notifiedAt ? `Notified ${new Date(s.notifiedAt).toLocaleString()}` : "Not notified"}</p>
                </div>
                {readOnly ? (
                  <span className={`shrink-0 px-1.5 text-[11px] font-medium capitalize ${STATUS_CLASS[s.status] ?? ""}`}>{s.status.replace("_", " ")}</span>
                ) : (
                  <select
                    value={s.status}
                    onChange={(e) => setStatus(s.id, e.target.value)}
                    className={`h-7 shrink-0 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-1.5 text-[11px] font-medium capitalize ${STATUS_CLASS[s.status] ?? ""}`}
                  >
                    {STATUS_OPTIONS.map((o) => <option key={o} value={o}>{o.replace("_", " ")}</option>)}
                  </select>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {!readOnly && <section className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--color-muted-foreground)]">Add stakeholder</h3>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {PRESETS.filter((p) => !tracked.has(p.toLowerCase())).map((p) => (
            <button key={p} type="button" onClick={() => add(p)} disabled={adding} className="rounded-[var(--radius-sm)] border border-[color:var(--color-border)] px-2 py-1 text-[11.5px] hover:border-[color:var(--mist-indigo)]/50 disabled:opacity-50">+ {p}</button>
          ))}
        </div>
        <button type="button" onClick={() => setPicking(true)} className="mb-2 inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] py-1.5 text-[12px] hover:border-[color:var(--mist-indigo)]/50">
          <UserPlus className="h-3.5 w-3.5 text-[color:var(--mist-indigo)]" /> Assign a user
        </button>
        <div className="flex gap-1.5">
          <input value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add(custom)} placeholder="Custom" className="h-8 flex-1 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 text-[12px]" />
          <button type="button" onClick={() => add(custom)} disabled={adding || !custom.trim()} className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] bg-[color:var(--mist-indigo)] text-white disabled:opacity-50">
            {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          </button>
        </div>
        <AssignUserModal open={picking} onClose={() => setPicking(false)} title="Add stakeholder" onSelect={(userId, member) => { if (member) void add(member.name ?? member.email, userId ?? undefined); }} />
      </section>}
    </div>
  );
}
