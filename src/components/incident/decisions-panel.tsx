"use client";

import { useCallback, useEffect, useState } from "react";
import { Gavel, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { useIncidentShell } from "./incident-shell";
import { apiErrorMessage } from "@/lib/incident/lock-shared";

interface Decision {
  id: string;
  title: string;
  status: string;
  decision: string | null;
  context: string | null;
}

// Common command decisions a major incident forces. Editable later.
const COMMON_DECISIONS = [
  "Do we declare this a major incident?",
  "Do we activate the IR retainer / external responders?",
  "Do we take affected systems offline?",
  "Do we pay the ransom?",
  "Do we notify customers now?",
  "Do we engage law enforcement?",
  "Do we file with the regulator now?",
  "Do we notify our cyber insurer?",
  "Do we invoke BCP / DR?",
  "Do we issue a public holding statement?",
];

const STATUS_CLASS: Record<string, string> = {
  open: "bg-[color:var(--mist-warn)]/15 text-[color:var(--mist-warn)]",
  decided: "bg-[color:var(--mist-ok)]/15 text-[color:var(--mist-ok)]",
  deferred: "bg-[color:var(--color-muted)] text-[color:var(--color-muted-foreground)]",
};

// decisions board. Logged as Question (the call to make) → Decision (what
// was decided). Common decisions are offered as a dropdown; custom questions are
// supported. Every open + resolution writes a decision_made entry to the ledger.
export function DecisionsPanel({ incidentId }: { incidentId: string }) {
  const [items, setItems] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [preset, setPreset] = useState("");
  const [customQ, setCustomQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [decisionText, setDecisionText] = useState("");
  const { readOnly } = useIncidentShell();

  const load = useCallback(async () => {
    const res = await fetch(`/api/incidents/${incidentId}/decisions`);
    if (res.ok) setItems((await res.json()).decisions ?? []);
    setLoading(false);
  }, [incidentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const title = preset === "__custom__" ? customQ.trim() : preset;
    if (!title) return;
    setAdding(true);
    const res = await fetch(`/api/incidents/${incidentId}/decisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    setAdding(false);
    if (res.ok) {
      setPreset("");
      setCustomQ("");
      void load();
    } else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't log decision. Try again."));
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/incidents/${incidentId}/decisions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setDeciding(null);
      setDecisionText("");
      void load();
    } else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't update. Try again."));
  };

  return (
    <section className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
      <div className="mb-3 flex items-center gap-2">
        <Gavel className="h-4 w-4 text-[color:var(--mist-indigo)]" />
        <h2 className="text-sm font-semibold">Decisions</h2>
      </div>

      {!readOnly && <div className="mb-3 space-y-2">
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
          className="h-8 w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 text-[12.5px]"
        >
          <option value="">Log a decision…</option>
          {COMMON_DECISIONS.map((q) => (
            <option key={q} value={q}>{q}</option>
          ))}
          <option value="__custom__">Custom question…</option>
        </select>
        {preset === "__custom__" && (
          <input
            value={customQ}
            onChange={(e) => setCustomQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="What needs deciding?"
            className="h-8 w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 text-[12.5px]"
            autoFocus
          />
        )}
        {preset && (
          <button
            type="button"
            onClick={add}
            disabled={adding || (preset === "__custom__" && !customQ.trim())}
            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[color:var(--mist-indigo)] px-2.5 py-1 text-[12px] font-medium text-white disabled:opacity-50"
          >
            {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Log decision
          </button>
        )}
      </div>}

      {loading ? (
        <div className="py-3 text-center text-xs text-[color:var(--color-muted-foreground)]">Loading…</div>
      ) : items.length === 0 ? (
        <p className="py-3 text-center text-xs text-[color:var(--color-muted-foreground)]">No decisions.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((d) => (
            <li key={d.id} className="rounded-[var(--radius-md)] border border-[color:var(--color-border)] p-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-medium leading-snug">{d.title}</p>
                <div className="flex shrink-0 items-center gap-1">
                  <Badge variant="outline" className={`text-[10px] capitalize ${STATUS_CLASS[d.status] ?? ""}`}>{d.status}</Badge>
                </div>
              </div>

              {d.status === "decided" && d.decision && (
                <p className="mt-1 rounded-[var(--radius-sm)] bg-[color:var(--mist-ok)]/5 px-2 py-1 text-[12px]">
                  <span className="font-semibold text-[color:var(--mist-ok)]">Decision: </span>
                  {d.decision}
                </p>
              )}

              {d.status === "open" && !readOnly &&
                (deciding === d.id ? (
                  <div className="mt-2 space-y-1.5">
                    <textarea
                      value={decisionText}
                      onChange={(e) => setDecisionText(e.target.value)}
                      rows={2}
                      autoFocus
                      placeholder="What was decided?"
                      className="w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1.5 text-[12.5px]"
                    />
                    <div className="flex justify-end gap-1.5">
                      <button type="button" onClick={() => { setDeciding(null); setDecisionText(""); }} className="px-2 py-1 text-[11px] text-[color:var(--color-muted-foreground)]">Cancel</button>
                      <button
                        type="button"
                        onClick={() => patch(d.id, { decision: decisionText.trim(), status: "decided" })}
                        disabled={!decisionText.trim()}
                        className="rounded-[var(--radius-sm)] bg-[color:var(--mist-ok)] px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                      >
                        Mark decided
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-1.5 flex gap-1.5">
                    <button type="button" onClick={() => { setDeciding(d.id); setDecisionText(""); }} className="rounded-[var(--radius-sm)] border border-[color:var(--color-border)] px-2 py-1 text-[11px] hover:border-[color:var(--mist-ok)]/50">Record decision</button>
                    <button type="button" onClick={() => patch(d.id, { status: "deferred" })} className="rounded-[var(--radius-sm)] border border-[color:var(--color-border)] px-2 py-1 text-[11px] text-[color:var(--color-muted-foreground)]">Defer</button>
                  </div>
                ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
