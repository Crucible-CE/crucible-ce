"use client";

// Evaluator ratings per objective (P/S/M/U, HSEEP), or "Not evaluated" with
// a reason when the exercise did not exercise or show the objective.
// Evaluators and the lead facilitator rate; the latest evaluator rating wins
// and earlier ones stay in the history. Ratings describe capabilities, not people.

import { useCallback, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { FieldSelect } from "@/components/form/field-select";
import { api } from "@/components/exercise/api";
import { formatInZone } from "@/lib/exercise/time";
import { NOT_EVALUATED_LABEL, RATINGS, RATING_LABELS, type Rating } from "@/lib/exercise/aar/schema";
import { cn } from "@/lib/utils";
import { usePoll } from "./use-poll";

type Stored = Rating | "N";

function ratingLabel(r: Stored): string {
  return r === "N" ? NOT_EVALUATED_LABEL : `${r}. ${RATING_LABELS[r]}`;
}

interface RatingView {
  id: string;
  rating: Stored;
  rationale: string | null;
  capabilityId: string | null;
  capabilityName: string | null;
  by: string | null;
  source: "evaluator" | "ai";
  createdAt: string;
}

interface ObjectiveRatings {
  objectiveId: string;
  seq: number;
  text: string;
  capabilityIds: string[];
  current: RatingView | null;
  history: RatingView[];
}

interface Listing {
  objectives: ObjectiveRatings[];
  capabilities: Array<{ id: string; key: string; name: string }>;
  canRate: boolean;
  closedReason?: string | null;
}

const RATING_VARIANT: Record<Stored, "success" | "accent" | "warning" | "destructive" | "outline"> = { P: "success", S: "accent", M: "warning", U: "destructive", N: "outline" };
type Choice = Rating | "not_evaluated";

function RatingForm({
  objective,
  capabilities,
  onSubmit,
}: {
  objective: ObjectiveRatings;
  capabilities: Listing["capabilities"];
  onSubmit: (body: { rating: Choice; rationale: string; capabilityId: string | null }) => Promise<boolean>;
}) {
  const cur = objective.current?.rating ?? null;
  const [rating, setRating] = useState<Choice | null>(cur === "N" ? "not_evaluated" : cur);
  const [rationale, setRationale] = useState("");
  const [capabilityId, setCapabilityId] = useState("");
  const [busy, setBusy] = useState(false);
  const caps = capabilities.filter((c) => objective.capabilityIds.includes(c.id));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!rating || !rationale.trim()) return;
    setBusy(true);
    const ok = await onSubmit({ rating, rationale: rationale.trim(), capabilityId: capabilityId || null });
    setBusy(false);
    if (ok) setRationale("");
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-md bg-[color:var(--color-muted)]/60 p-3">
      <div className="grid gap-1.5 sm:grid-cols-2" role="radiogroup" aria-label="Rating">
        {RATINGS.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={rating === r}
            onClick={() => setRating(r)}
            className={cn(
              "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[12.5px] transition-colors",
              rating === r ? "border-[color:var(--mist-indigo)] bg-[color:var(--mist-indigo-soft)]" : "border-[color:var(--color-border)] hover:bg-[color:var(--color-muted)]",
            )}
          >
            <span className="font-mono font-semibold">{r}</span>
            <span>{RATING_LABELS[r]}</span>
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={rating === "not_evaluated"}
          onClick={() => setRating("not_evaluated")}
          className={cn(
            "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[12.5px] transition-colors sm:col-span-2",
            rating === "not_evaluated" ? "border-[color:var(--mist-indigo)] bg-[color:var(--mist-indigo-soft)]" : "border-[color:var(--color-border)] hover:bg-[color:var(--color-muted)]",
          )}
        >
          <span>{NOT_EVALUATED_LABEL}</span>
        </button>
      </div>
      {rating === "not_evaluated" && (
        <p className="text-[12px] text-[color:var(--color-muted-foreground)]">Use this when the exercise did not exercise or show this objective. U means the team tried and could not do it.</p>
      )}
      <Textarea
        aria-label="Rationale"
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder={rating === "not_evaluated" ? "Reason" : "Rationale"}
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {caps.length > 0 && (
          <FieldSelect
            aria-label="Capability"
            value={capabilityId}
            onChange={setCapabilityId}
            options={[{ value: "", label: "No capability" }, ...caps.map((c) => ({ value: c.id, label: `${c.key} ${c.name}` }))]}
            className="h-9 sm:max-w-xs"
          />
        )}
        <Button type="submit" size="sm" className="sm:ml-auto" disabled={busy || !rating || !rationale.trim()}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Save rating
        </Button>
      </div>
    </form>
  );
}

export function RatingsPanel({ exerciseId, timezone }: { exerciseId: string; timezone: string }) {
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<Listing>(`/api/exercises/${exerciseId}/ratings`);
    if (r.ok) {
      setData(r.data);
      setError(null);
    } else setError(r.error);
  }, [exerciseId]);
  usePoll(load, 15000);

  async function rate(objectiveId: string, body: { rating: Choice; rationale: string; capabilityId: string | null }): Promise<boolean> {
    const r = await api(`/api/exercises/${exerciseId}/ratings`, { body: { objectiveId, ...body }, fallback: "The rating was not saved. Try again." });
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    toast.success("Rating saved.");
    void load();
    return true;
  }

  if (!data) {
    if (error) return <p role="alert" className="text-[13px] text-[color:var(--mist-danger)]">{error}</p>;
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-[color:var(--color-muted-foreground)]" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-[color:var(--color-muted-foreground)]">
        {data.closedReason ?? (data.canRate ? "Rate each objective. The latest rating counts." : "Evaluators and the lead facilitator rate objectives.")}
      </p>
      {data.objectives.length === 0 && <p className="py-4 text-center text-[13px] text-[color:var(--color-muted-foreground)]">This exercise has no objectives.</p>}
      {data.objectives.map((o) => (
        <Card key={o.objectiveId} dense className="gap-3">
          <div className="flex flex-wrap items-start gap-2">
            <h3 className="min-w-0 flex-1 text-[14px] font-semibold">
              Objective {o.seq}. {o.text}
            </h3>
            {o.current ? (
              <Badge variant={RATING_VARIANT[o.current.rating]}>{ratingLabel(o.current.rating)}</Badge>
            ) : (
              <Badge variant="outline">Not rated</Badge>
            )}
          </div>
          {o.current?.rationale && <p className="whitespace-pre-wrap text-[13px]">{o.current.rationale}</p>}
          {o.current && (
            <p className="text-[11.5px] text-[color:var(--color-muted-foreground)]">
              {[o.current.by, o.current.capabilityName, formatInZone(new Date(o.current.createdAt), timezone)].filter(Boolean).join(" · ")}
            </p>
          )}
          {data.canRate && <RatingForm objective={o} capabilities={data.capabilities} onSubmit={(b) => rate(o.objectiveId, b)} />}
          {o.history.length > 1 && (
            <div>
              <Button size="xs" variant="ghost" onClick={() => setOpen(open === o.objectiveId ? null : o.objectiveId)}>
                {open === o.objectiveId ? "Hide history" : `History (${o.history.length})`}
              </Button>
              {open === o.objectiveId && (
                <ul className="mt-1 space-y-1">
                  {o.history.map((h) => (
                    <li key={h.id} className="text-[12px]">
                      <span className="font-mono font-semibold">{h.rating === "N" ? NOT_EVALUATED_LABEL : h.rating}</span> {h.rationale}{" "}
                      <span className="text-[color:var(--color-muted-foreground)]">
                        {[h.by, formatInZone(new Date(h.createdAt), timezone)].filter(Boolean).join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
