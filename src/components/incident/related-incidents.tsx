"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { GitMerge, X } from "lucide-react";
import { toast } from "sonner";
import { useIncidentShell } from "@/components/incident/incident-shell";
import { apiErrorMessage } from "@/lib/incident/lock-shared";

interface LinkRow { linkId: string; relation: string; incident: { id: string; title: string; severity: string; status: string } }
interface PickItem { id: string; title: string; severity?: string; status?: string }

const RELATIONS = ["related", "duplicate", "parent", "child"];

export function RelatedIncidents({ incidentId }: { incidentId: string }) {
  // Linking/unlinking needs incidents.edit and is lock-guarded server-side.
  const { readOnly } = useIncidentShell();
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [picker, setPicker] = useState<PickItem[]>([]);
  const [relation, setRelation] = useState("related");
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch(`/api/incidents/${incidentId}/links`);
    if (res.ok) setLinks((await res.json()).links);
    setLoading(false);
  }, [incidentId]);
  useEffect(() => { void load(); }, [load]);

  const openAdd = async () => {
    setAdding(true);
    try {
      const res = await fetch(`/api/incidents`);
      if (res.ok) {
        const d = await res.json();
        const list: PickItem[] = (Array.isArray(d) ? d : d.incidents ?? []).filter((i: PickItem) => i.id !== incidentId);
        setPicker(list);
      }
    } catch { /* ignore */ }
  };
  const add = async () => {
    if (!target) return;
    const res = await fetch(`/api/incidents/${incidentId}/links`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ relatedIncidentId: target, relationType: relation }) });
    if (res.ok) { setAdding(false); setTarget(""); void load(); } else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't link. Try again."));
  };
  const remove = async (linkId: string) => {
    const res = await fetch(`/api/incidents/${incidentId}/links/${linkId}`, { method: "DELETE" });
    if (!res.ok) toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't unlink. Try again."));
    void load();
  };

  if (loading) return null;
  if (links.length === 0 && !adding) {
    if (readOnly) return null;
    return (
      <div className="rounded-xl border border-border bg-card/60 p-4">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground"><GitMerge className="h-3.5 w-3.5" /> Related</h3>
          <button onClick={openAdd} className="text-xs text-[color:var(--mist-indigo)]">+ Link</button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground"><GitMerge className="h-3.5 w-3.5" /> Related incidents</h3>
        {!readOnly && <button onClick={openAdd} className="text-xs text-[color:var(--mist-indigo)]">+ Link</button>}
      </div>
      {adding && !readOnly && (
        <div className="mb-2 space-y-2 rounded-lg border border-[color:var(--color-border)] p-2">
          <select value={relation} onChange={(e) => setRelation(e.target.value)} className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1 text-xs capitalize">
            {RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={target} onChange={(e) => setTarget(e.target.value)} className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1 text-xs">
            <option value="">Select incident</option>
            {picker.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
          <div className="flex justify-end gap-1.5">
            <button onClick={() => setAdding(false)} className="rounded border border-[color:var(--color-border)] px-2 py-1 text-xs">Cancel</button>
            <button onClick={add} className="rounded bg-[color:var(--mist-indigo)] px-2 py-1 text-xs font-medium text-white">Link</button>
          </div>
        </div>
      )}
      <div className="space-y-1">
        {links.map((l) => (
          <div key={l.linkId} className="flex items-center gap-2 text-xs">
            <span className="rounded bg-[color:var(--color-muted)] px-1 text-[10px] uppercase text-muted-foreground">{l.relation}</span>
            <Link href={`/incidents/${l.incident.id}`} className="min-w-0 flex-1 truncate hover:underline">{l.incident.title}</Link>
            {!readOnly && <button onClick={() => remove(l.linkId)} aria-label="Unlink" className="text-muted-foreground hover:text-[color:var(--mist-danger)]"><X className="h-3 w-3" /></button>}
          </div>
        ))}
      </div>
    </div>
  );
}
