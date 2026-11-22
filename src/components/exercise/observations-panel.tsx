"use client";

// Observations: control records any kind and links each one to a delivered
// inject, an objective and a capability. Scribes record plain observations.
// Authors edit and delete their own. Players never see these.

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { FieldSelect } from "@/components/form/field-select";
import { formatClock } from "@/lib/exercise/time";
import { api } from "./api";
import type { InjectHeader } from "./types";

interface Observation {
  id: string;
  kind: string;
  text: string;
  at: string;
  author: string | null;
  authorParticipantId: string | null;
  injectId: string | null;
  injectSeq: number | null;
  injectTitle: string | null;
  objectiveId: string | null;
  objectiveText: string | null;
  capabilityId: string | null;
  capabilityName: string | null;
}

interface Options {
  injects: Array<{ id: string; seq: number; title: string }>;
  objectives: Array<{ id: string; seq: number; text: string }>;
  capabilities: Array<{ id: string; key: string; name: string }>;
}

interface Listing {
  observations: Observation[];
  options: Options;
  me: string | null;
  role: "control" | "scribe";
}

const KIND_OPTIONS = [
  { value: "observation", label: "Observation" },
  { value: "strength", label: "Strength" },
  { value: "afi", label: "Area for improvement" },
];
const KIND_LABEL: Record<string, string> = Object.fromEntries(KIND_OPTIONS.map((k) => [k.value, k.label]));

interface Draft {
  text: string;
  kind: string;
  injectId: string;
  objectiveId: string;
  capabilityId: string;
}

function ObservationForm({
  options,
  role,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  options: Options;
  role: "control" | "scribe";
  initial: Draft;
  submitLabel: string;
  onSubmit: (d: Draft) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // A new current inject becomes the default link for a fresh form.
    if (!onCancel) setD((prev) => (prev.text ? prev : { ...prev, injectId: initial.injectId }));
  }, [initial.injectId, onCancel]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!d.text.trim()) return;
    setBusy(true);
    const ok = await onSubmit({ ...d, text: d.text.trim() });
    setBusy(false);
    if (ok && !onCancel) setD({ ...initial, text: "" });
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-md bg-[color:var(--color-muted)]/60 p-3">
      <Textarea aria-label="Observation" value={d.text} onChange={(e) => setD({ ...d, text: e.target.value })} rows={3} maxLength={4000} placeholder="What did you see?" />
      <div className="grid gap-2 sm:grid-cols-2">
        {role === "control" && <FieldSelect aria-label="Type" value={d.kind} onChange={(v) => setD({ ...d, kind: v })} options={KIND_OPTIONS} className="h-9" />}
        <FieldSelect
          aria-label="Inject"
          value={d.injectId}
          onChange={(v) => setD({ ...d, injectId: v })}
          options={[{ value: "", label: "No inject" }, ...options.injects.map((i) => ({ value: i.id, label: `${i.seq}. ${i.title}` }))]}
          className="h-9"
        />
        <FieldSelect
          aria-label="Objective"
          value={d.objectiveId}
          onChange={(v) => setD({ ...d, objectiveId: v })}
          options={[{ value: "", label: "No objective" }, ...options.objectives.map((o) => ({ value: o.id, label: `${o.seq}. ${o.text}` }))]}
          className="h-9"
        />
        <FieldSelect
          aria-label="Capability"
          value={d.capabilityId}
          onChange={(v) => setD({ ...d, capabilityId: v })}
          options={[{ value: "", label: "No capability" }, ...options.capabilities.map((c) => ({ value: c.id, label: `${c.key} ${c.name}` }))]}
          className="h-9"
        />
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
        <Button type="submit" size="sm" disabled={busy || !d.text.trim()}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

const toBody = (d: Draft) => ({
  text: d.text,
  kind: d.kind,
  injectId: d.injectId || null,
  objectiveId: d.objectiveId || null,
  capabilityId: d.capabilityId || null,
});

export function ObservationsPanel({
  exerciseId,
  tick,
  timezone,
  currentInject,
}: {
  exerciseId: string;
  tick: number;
  timezone: string;
  currentInject: InjectHeader | null | undefined;
}) {
  const confirm = useConfirm();
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<Listing>(`/api/exercises/${exerciseId}/observations`);
    if (r.ok) {
      setData(r.data);
      setError(null);
    } else setError(r.error);
  }, [exerciseId]);

  useEffect(() => {
    void load();
  }, [load, tick]);

  const delivered = currentInject && (currentInject.status === "open" || currentInject.status === "closed") ? currentInject.id : "";

  async function add(d: Draft): Promise<boolean> {
    const r = await api(`/api/exercises/${exerciseId}/observations`, { body: toBody(d), fallback: "The observation was not saved. Try again." });
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    void load();
    return true;
  }

  async function save(id: string, d: Draft): Promise<boolean> {
    const r = await api(`/api/exercises/${exerciseId}/observations`, {
      method: "PATCH",
      body: { id, ...toBody(d) },
      fallback: "The change was not saved. Try again.",
    });
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    setEditing(null);
    void load();
    return true;
  }

  async function remove(o: Observation) {
    const ok = await confirm({ title: "Delete this observation?", description: "The audit log keeps a copy.", confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    const r = await api(`/api/exercises/${exerciseId}/observations`, { method: "DELETE", body: { id: o.id }, fallback: "The observation was not deleted. Try again." });
    if (!r.ok) toast.error(r.error);
    void load();
  }

  if (!data) {
    if (error) return <p role="alert" className="text-[13px] text-[color:var(--mist-danger)]">{error}</p>;
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-[color:var(--color-muted-foreground)]" />
      </div>
    );
  }

  const blank: Draft = { text: "", kind: "observation", injectId: delivered, objectiveId: "", capabilityId: "" };

  return (
    <div className="space-y-4">
      <ObservationForm options={data.options} role={data.role} initial={blank} submitLabel="Add" onSubmit={add} />
      <p className="text-[12px] text-[color:var(--color-muted-foreground)]">
        {data.role === "scribe" ? "Players never see these. You see your own." : "Players never see these."}
      </p>
      {data.observations.length === 0 ? (
        <p className="py-4 text-center text-[13px] text-[color:var(--color-muted-foreground)]">No observations yet.</p>
      ) : (
        <ul className="space-y-2">
          {data.observations.map((o) => {
            const mine = Boolean(data.me && o.authorParticipantId === data.me);
            if (editing === o.id) {
              return (
                <li key={o.id}>
                  <ObservationForm
                    options={data.options}
                    role={data.role}
                    initial={{ text: o.text, kind: o.kind, injectId: o.injectId ?? "", objectiveId: o.objectiveId ?? "", capabilityId: o.capabilityId ?? "" }}
                    submitLabel="Save"
                    onSubmit={(d) => save(o.id, d)}
                    onCancel={() => setEditing(null)}
                  />
                </li>
              );
            }
            return (
              <li key={o.id} className="rounded-md bg-[color:var(--color-muted)]/60 px-3 py-2 text-[13px]">
                <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-[color:var(--color-muted-foreground)]">
                  <Badge variant={o.kind === "strength" ? "success" : o.kind === "afi" ? "warning" : "outline"}>{KIND_LABEL[o.kind] ?? o.kind}</Badge>
                  {o.injectSeq !== null && <span>Inject {o.injectSeq}</span>}
                  {o.author && <span>{o.author}</span>}
                  <time className="ml-auto font-mono tabular-nums" dateTime={o.at}>
                    {formatClock(new Date(o.at), timezone)}
                  </time>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words">{o.text}</p>
                {o.objectiveText && <p className="mt-1 text-[12px] text-[color:var(--color-muted-foreground)]">Objective. {o.objectiveText}</p>}
                {o.capabilityName && <p className="text-[12px] text-[color:var(--color-muted-foreground)]">Capability. {o.capabilityName}</p>}
                {mine && (
                  <div className="mt-1 flex justify-end gap-1">
                    <Button size="xs" variant="ghost" onClick={() => setEditing(o.id)}>
                      Edit
                    </Button>
                    <Button size="xs" variant="ghost" className="text-[color:var(--mist-danger)]" onClick={() => void remove(o)}>
                      Delete
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
