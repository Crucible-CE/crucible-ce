"use client";

// Read-only observation log for the hotwash and the evaluator debrief.

import { useCallback, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { api } from "@/components/exercise/api";
import { formatInZone } from "@/lib/exercise/time";
import { usePoll } from "./use-poll";

interface Observation {
  id: string;
  kind: string;
  text: string;
  at: string;
  author: string | null;
  injectSeq: number | null;
  objectiveText: string | null;
  capabilityName: string | null;
}

const KIND_LABEL: Record<string, string> = { observation: "Observation", strength: "Strength", afi: "Area for improvement" };

export function ObservationLog({ exerciseId, timezone }: { exerciseId: string; timezone: string }) {
  const [items, setItems] = useState<Observation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<{ observations: Observation[] }>(`/api/exercises/${exerciseId}/observations`);
    if (r.ok) {
      setItems([...r.data.observations].reverse());
      setError(null);
    } else setError(r.error);
  }, [exerciseId]);
  usePoll(load, 30000);

  if (!items) {
    if (error) return <p role="alert" className="text-[13px] text-[color:var(--mist-danger)]">{error}</p>;
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-[color:var(--color-muted-foreground)]" />
      </div>
    );
  }
  if (items.length === 0) return <p className="py-4 text-center text-[13px] text-[color:var(--color-muted-foreground)]">No observations recorded.</p>;
  return (
    <ul className="space-y-2">
      {items.map((o) => (
        <li key={o.id} className="rounded-md bg-[color:var(--color-muted)]/60 px-3 py-2 text-[13px]">
          <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-[color:var(--color-muted-foreground)]">
            <Badge variant={o.kind === "strength" ? "success" : o.kind === "afi" ? "warning" : "outline"}>{KIND_LABEL[o.kind] ?? o.kind}</Badge>
            {o.injectSeq !== null && <span>Inject {o.injectSeq}</span>}
            {o.author && <span>{o.author}</span>}
            <time className="ml-auto font-mono tabular-nums" dateTime={o.at}>
              {formatInZone(new Date(o.at), timezone)}
            </time>
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words">{o.text}</p>
          {o.objectiveText && <p className="mt-1 text-[12px] text-[color:var(--color-muted-foreground)]">Objective. {o.objectiveText}</p>}
          {o.capabilityName && <p className="text-[12px] text-[color:var(--color-muted-foreground)]">Capability. {o.capabilityName}</p>}
        </li>
      ))}
    </ul>
  );
}
