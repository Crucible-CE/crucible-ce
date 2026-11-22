"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardList, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useIncidentShell } from "@/components/incident/incident-shell";
import { apiErrorMessage } from "@/lib/incident/lock-shared";
import { parseYmdLocal } from "@/lib/datetime/local";

interface CA { id: string; title: string; ownerName: string | null; dueAt: string | null; status: string }
const STATUS = ["open", "in_progress", "done", "cancelled"];
const STATUS_STYLE: Record<string, string> = {
  open: "bg-[color:var(--mist-amber)]/15 text-[color:var(--mist-amber)]",
  in_progress: "bg-[color:var(--mist-indigo)]/15 text-[color:var(--mist-indigo)]",
  done: "bg-[color:var(--mist-emerald)]/15 text-[color:var(--mist-emerald)]",
  cancelled: "bg-[color:var(--color-muted)] text-[color:var(--color-muted-foreground)]",
};

// Corrective actions / lessons learned, tracked to closure (the improvement loop).
export function CorrectiveActions({ incidentId }: { incidentId: string }) {
  const { readOnly } = useIncidentShell();
  const [actions, setActions] = useState<CA[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", ownerName: "", dueAt: "" });

  const load = useCallback(async () => {
    const res = await fetch(`/api/incidents/${incidentId}/corrective-actions`);
    if (res.ok) setActions((await res.json()).actions);
  }, [incidentId]);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!form.title.trim()) return;
    const res = await fetch(`/api/incidents/${incidentId}/corrective-actions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: form.title, ownerName: form.ownerName.trim() || null, dueAt: form.dueAt ? parseYmdLocal(form.dueAt).toISOString() : null }),
    });
    if (res.ok) { setForm({ title: "", ownerName: "", dueAt: "" }); setOpen(false); void load(); } else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't add. Try again."));
  };
  const setStatus = async (id: string, status: string) => {
    const res = await fetch(`/api/incidents/${incidentId}/corrective-actions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (!res.ok) toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't update status. Try again."));
    void load();
  };
  const del = async (id: string) => {
    const res = await fetch(`/api/incidents/${incidentId}/corrective-actions/${id}`, { method: "DELETE" });
    if (!res.ok) toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't delete. Try again."));
    void load();
  };

  const openCount = actions.filter((a) => a.status === "open" || a.status === "in_progress").length;

  return (
    <div className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><ClipboardList className="h-4 w-4 text-[color:var(--mist-indigo)]" /> Corrective actions <span className="text-muted-foreground">· {openCount} open</span></h2>
        {!readOnly && <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 rounded-md border border-[color:var(--color-border)] px-2 py-1 text-xs"><Plus className="h-3 w-3" /> Add</button>}
      </div>

      {open && !readOnly && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[color:var(--color-border)] p-2.5">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Corrective action" className="min-w-[180px] flex-1 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1.5 text-sm" />
          <input value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} placeholder="Owner" className="w-28 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1.5 text-sm" />
          <input type="date" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1.5 text-sm" />
          <button onClick={add} className="rounded-md bg-[color:var(--mist-indigo)] px-3 py-1.5 text-sm font-medium text-white">Add</button>
        </div>
      )}

      {actions.length === 0 ? <p className="text-xs text-muted-foreground">No corrective actions.</p> : (
        <div className="space-y-1.5">
          {actions.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-md border border-[color:var(--color-border)] px-2.5 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{a.title}</div>
                <div className="text-[11px] text-muted-foreground">{a.ownerName ?? "Unassigned"}{a.dueAt ? ` · due ${new Date(a.dueAt).toLocaleDateString()}` : ""}</div>
              </div>
              {readOnly ? (
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase", STATUS_STYLE[a.status])}>{a.status.replace("_", " ")}</span>
              ) : (
                <>
                  <select value={a.status} onChange={(e) => setStatus(a.id, e.target.value)} className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase border-0", STATUS_STYLE[a.status])}>
                    {STATUS.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                  </select>
                  <button onClick={() => del(a.id)} aria-label="Delete" className="text-muted-foreground hover:text-[color:var(--mist-danger)]"><Trash2 className="h-3.5 w-3.5" /></button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
