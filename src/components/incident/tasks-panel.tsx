"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ListChecks, Plus, Loader2, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { useIncidentShell } from "./incident-shell";
import { apiErrorMessage } from "@/lib/incident/lock-shared";

function formatDue(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

interface Task {
  id: string;
  title: string;
  assigneeId: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  acknowledgedAt?: string | null;
}

const STATUS_CLASS: Record<string, string> = {
  open: "bg-[color:var(--color-muted)] text-[color:var(--color-muted-foreground)]",
  acknowledged: "bg-[color:var(--mist-indigo)]/15 text-[color:var(--mist-indigo)]",
  in_progress: "bg-[color:var(--mist-warn)]/15 text-[color:var(--mist-warn)]",
  done: "bg-[color:var(--mist-ok)]/15 text-[color:var(--mist-ok)]",
  blocked: "bg-[color:var(--mist-danger)]/15 text-[color:var(--mist-danger)]",
};

const PRIORITY_CLASS: Record<string, string> = {
  low: "text-[color:var(--color-muted-foreground)]",
  medium: "text-[color:var(--mist-indigo)]",
  high: "text-orange-600 dark:text-orange-400",
  critical: "text-[color:var(--mist-danger)]",
};

// War-room action tickets. Quick-add here; click into the full ticket page to
// assign, acknowledge, respond, upload, and see the per-ticket audit trail.
export function TasksPanel({ incidentId }: { incidentId: string }) {
  const [items, setItems] = useState<Task[]>([]);
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const { readOnly } = useIncidentShell();

  const load = useCallback(async () => {
    const [tRes, mRes] = await Promise.all([fetch(`/api/incidents/${incidentId}/tasks`), fetch(`/api/org-members`)]);
    if (tRes.ok) setItems((await tRes.json()).tasks ?? []);
    if (mRes.ok) {
      const ms = await mRes.json();
      const nm: Record<string, string> = {};
      for (const m of ms) nm[m.id] = m.name ?? m.email;
      setMemberNames(nm);
    }
    setLoading(false);
  }, [incidentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!title.trim()) return;
    setAdding(true);
    const res = await fetch(`/api/incidents/${incidentId}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });
    setAdding(false);
    if (res.ok) {
      setTitle("");
      void load();
    } else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't add task. Try again."));
  };

  return (
    <section className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
      <div className="mb-3 flex items-center gap-2">
        <ListChecks className="h-4 w-4 text-[color:var(--mist-indigo)]" />
        <h2 className="text-sm font-semibold">Work items</h2>
      </div>

      {!readOnly && <div className="mb-3 flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Add an action…"
          className="h-8 flex-1 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 text-[12.5px]"
        />
        <button type="button" onClick={add} disabled={adding || !title.trim()} className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] bg-[color:var(--mist-indigo)] text-white disabled:opacity-50">
          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        </button>
      </div>}

      {loading ? (
        <div className="py-3 text-center text-xs text-[color:var(--color-muted-foreground)]">Loading…</div>
      ) : items.length === 0 ? (
        <p className="py-3 text-center text-xs text-[color:var(--color-muted-foreground)]">No work items.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((t) => (
            <li key={t.id}>
              <Link
                href={`/incidents/${incidentId}/tasks/${t.id}`}
                className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border)] p-2 hover:border-[color:var(--mist-indigo)]/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px]">{t.title}</p>
                  <p className="text-[10.5px] text-[color:var(--color-muted-foreground)]">
                    <span className={PRIORITY_CLASS[t.priority]}>{t.priority}</span>
                    {t.assigneeId && ` · ${memberNames[t.assigneeId] ?? "Assigned"}`}
                    {t.dueAt && ` · due ${formatDue(t.dueAt)}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge variant="outline" className={`text-[10px] capitalize ${STATUS_CLASS[t.status] ?? ""}`}>{t.status.replace("_", " ")}</Badge>
                  <ChevronRight className="h-3.5 w-3.5 text-[color:var(--color-muted-foreground)]" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
