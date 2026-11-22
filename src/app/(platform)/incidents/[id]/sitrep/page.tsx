"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { FileText, Loader2, Copy, Check, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { StatusPanels } from "@/components/incident/status-panels";
import { useIncidentShell } from "@/components/incident/incident-shell";
import { apiErrorMessage } from "@/lib/incident/lock-shared";
import { CloudSeam } from "@/components/cloud/cloud-seam";

interface Sitrep {
  id: string;
  content: string;
  generatedByName: string | null;
  createdAt: string;
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] px-2 py-1 text-[11px] hover:border-[color:var(--mist-indigo)]/50"
    >
      {done ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      Copy
    </button>
  );
}

export default function IncidentSitrepPage() {
  const { id } = useParams<{ id: string }>();
  const { readOnly } = useIncidentShell();
  const [sitreps, setSitreps] = useState<Sitrep[]>([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [publishing, setPublishing] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/incidents/${id}/sitrep`);
    if (res.ok) setSitreps((await res.json()).sitreps ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const publish = async () => {
    if (!draft.trim()) return;
    setPublishing(true);
    try {
      const res = await fetch(`/api/incidents/${id}/sitrep`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft.trim() }),
      });
      if (res.ok) {
        toast.success("SITREP published");
        setDraft("");
        setComposing(false);
        await load();
      } else {
        toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't publish. Try again."));
      }
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Status — Business Impact + Handover (merged from the old Status tab) */}
      <StatusPanels incidentId={id} />

      <section className="flex items-center justify-between rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-[color:var(--mist-indigo)]" />
          <div>
            <h2 className="text-sm font-semibold">Situation reports</h2>
            <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
              Point-in-time exec/board summary of the incident state.
            </p>
          </div>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={() => setComposing((v) => !v)}
            className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[color:var(--mist-indigo)] px-3 py-2 text-[13px] font-semibold text-white"
          >
            <Plus className="h-4 w-4" />
            New SITREP
          </button>
        )}
      </section>

      {composing && !readOnly && (
        <section className="space-y-2 rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={10}
            autoFocus
            placeholder={"SITREP as of ...\n\nSituation:\nActions taken:\nNext steps:\nDecisions needed:"}
            className="w-full rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 py-2 font-mono text-[13px] leading-relaxed"
          />
          <CloudSeam feature="sitrep-drafting" />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setComposing(false)}
              className="rounded-[var(--radius-md)] border border-[color:var(--color-border)] px-3 py-1.5 text-[13px]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={publish}
              disabled={publishing || !draft.trim()}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[color:var(--mist-indigo)] px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-60"
            >
              {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Publish
            </button>
          </div>
        </section>
      )}

      {loading ? (
        <div className="h-32 animate-pulse rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-muted)]/30" />
      ) : sitreps.length === 0 ? (
        <p className="py-8 text-center text-xs text-[color:var(--color-muted-foreground)]">
          No SITREPs.
        </p>
      ) : (
        <div className="space-y-3">
          {sitreps.map((s) => (
            <article key={s.id} className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] text-[color:var(--color-muted-foreground)]">
                  {new Date(s.createdAt).toLocaleString()} · {s.generatedByName ?? "Unknown"}
                </span>
                <CopyBtn text={s.content} />
              </div>
              <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-[color:var(--color-foreground)]">
                {s.content}
              </pre>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
