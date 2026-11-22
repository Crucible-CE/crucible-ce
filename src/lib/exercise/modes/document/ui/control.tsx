"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, MonitorPlay, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CloudSeam } from "@/components/cloud/cloud-seam";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { FieldSelect } from "@/components/form/field-select";
import type { ModeViewProps } from "@/lib/exercise/modes/ui";
import { GRADE_RATINGS, GRADE_RATING_LABELS, type GradeRating } from "../schema";
import {
  EarlierModules,
  EntryComposer,
  EntryRow,
  GradeChip,
  ModuleBody,
  Notice,
  SectionLabel,
  scenarioClock,
} from "./shared";
import { asDocState, type DocEntry, type DocModule, type DocState } from "./types";

async function send(url: string, method: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: data?.error };
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection and try again." };
  }
}

export function ControlView(props: ModeViewProps) {
  const state = asDocState(props.state);
  if (!state) return <Notice text="Loading the exercise." />;
  const current = state.injects.find((i) => i.id === state.current) ?? null;
  const earlier = state.injects.filter((i) => i.status === "closed" && i.id !== current?.id).sort((a, b) => b.seq - a.seq);
  const paused = state.exercise.status === "paused";

  const renderEntry = (m: DocModule, e: DocEntry) => (
    <EntryRow key={e.id} state={state} module={m} entry={e}>
      <ControlEntryTools exerciseId={props.exerciseId} state={state} entry={e} refresh={props.refresh} />
    </EntryRow>
  );

  return (
    <div className="space-y-4 pb-10">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-[color:var(--color-muted-foreground)]">
          {current ? `Module ${current.seq}${state.modulesTotal ? ` of ${state.modulesTotal}` : ""}` : "No module open"}
          {state.config.scribeMode ? ". Scribe mode." : ""}
        </p>
        <a
          href={`/present/${props.exerciseId}`}
          target="_blank"
          rel="noopener"
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-[color:var(--color-foreground)] shadow-[var(--elevation-0)] hover:bg-[color:var(--color-muted)]"
        >
          <MonitorPlay className="h-4 w-4" aria-hidden />
          Presenter view
        </a>
      </div>

      {!current && <Notice text="Advance to open the first module." />}

      {current && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
          <div className="space-y-4">
            <Card className="gap-4">
              <div className="space-y-1">
                <p className="text-xs text-[color:var(--color-muted-foreground)]">
                  {current.status === "open" ? "Open" : current.status === "closed" ? "Closed" : "Waiting"}
                  {scenarioClock(state, current.scenarioTime) ? `, ${scenarioClock(state, current.scenarioTime)}` : ""}
                </p>
                <h2 className="font-display text-xl font-semibold leading-tight">{current.title}</h2>
              </div>
              <ModuleBody state={state} module={current} />
            </Card>

            {current.status === "open" && state.canPost && <EntryComposer key={current.id} state={state} module={current} respond={props.respond} disabled={paused} />}

            <div className="space-y-2">
              <SectionLabel>Entries</SectionLabel>
              {current.entries.length === 0 ? (
                <p className="text-sm text-[color:var(--color-muted-foreground)]">No entries yet.</p>
              ) : (
                <ul className="space-y-2">{current.entries.map((e) => renderEntry(current, e))}</ul>
              )}
            </div>
          </div>

          <FacilitatorPanel state={state} module={current} />
        </div>
      )}

      <EarlierModules state={state} modules={earlier} renderEntry={renderEntry} />
    </div>
  );
}

function FacilitatorPanel({ module }: { state: DocState; module: DocModule }) {
  const c = module.control;
  const unanswered = module.questions.filter((q) => !q.answered);
  return (
    <Card dense className="h-fit gap-4">
      {c?.rationale && (
        <div className="space-y-1">
          <SectionLabel>What this module tests</SectionLabel>
          <p className="text-sm">{c.rationale}</p>
        </div>
      )}
      {c?.sourceExcerpt && (
        <div className="space-y-1">
          <SectionLabel>From the document</SectionLabel>
          <blockquote className="whitespace-pre-wrap border-l-2 border-[color:var(--color-border)] pl-3 text-sm text-[color:var(--color-muted-foreground)]">
            {c.sourceExcerpt}
          </blockquote>
        </div>
      )}
      <div className="space-y-1">
        <SectionLabel>Expected actions</SectionLabel>
        {c?.expectedActions.length ? (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {c.expectedActions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[color:var(--color-muted-foreground)]">None listed.</p>
        )}
      </div>
      <div className="space-y-1">
        <SectionLabel>Unanswered questions</SectionLabel>
        {unanswered.length === 0 ? (
          <p className="text-sm text-[color:var(--color-muted-foreground)]">Every question has an entry.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {unanswered.map((q) => (
              <li key={q.key}>
                <span className="font-mono text-xs text-[color:var(--color-muted-foreground)]">{module.questions.indexOf(q) + 1}.</span> {q.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function ControlEntryTools({ exerciseId, state, entry, refresh }: { exerciseId: string; state: DocState; entry: DocEntry; refresh: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function setStatus(status: "confirmed" | "denied" | "submitted") {
    setBusy(status);
    const r = await send(`/api/exercises/${exerciseId}/document/entries/${entry.id}`, "PATCH", { status });
    setBusy(null);
    if (!r.ok) toast.error(r.error ?? "The entry was not updated. Try again.");
    refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {state.canModerate && entry.status !== "confirmed" && (
          <Button size="xs" variant="outline" disabled={busy !== null} onClick={() => void setStatus("confirmed")}>
            {busy === "confirmed" ? <Loader2 className="animate-spin" /> : <Check />}
            Confirm
          </Button>
        )}
        {state.canModerate && entry.status !== "denied" && (
          <Button size="xs" variant="outline" disabled={busy !== null} onClick={() => void setStatus("denied")}>
            {busy === "denied" ? <Loader2 className="animate-spin" /> : <X />}
            Deny
          </Button>
        )}
        {state.canModerate && entry.status !== "submitted" && (
          <Button size="xs" variant="ghost" disabled={busy !== null} onClick={() => void setStatus("submitted")}>
            <RotateCcw />
            Reset
          </Button>
        )}
        <GradeChip grade={entry.grade} />
        {entry.graded && !entry.grade && <span className="text-xs text-[color:var(--color-muted-foreground)]">Not graded yet.</span>}
        {state.canGrade && (entry.graded || entry.grade) && (
          <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? "Hide grade" : "Grade"}
          </Button>
        )}
      </div>
      {open && <GradePanel exerciseId={exerciseId} entry={entry} refresh={refresh} />}
    </div>
  );
}

const SCORES = [0, 1, 2, 3, 4];

function ratingFor(score: number): GradeRating {
  if (score >= 3) return "met";
  if (score >= 2) return "partially_met";
  return "not_met";
}

function GradePanel({ exerciseId, entry, refresh }: { exerciseId: string; entry: DocEntry; refresh: () => void }) {
  const [criteria, setCriteria] = useState<Array<{ id: string; text: string }> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const base = entry.grade;
  const [score, setScore] = useState(String(base?.score ?? 2));
  const [rating, setRating] = useState<GradeRating>((base?.rating as GradeRating) ?? ratingFor(Number(base?.score ?? 2)));
  const [rationale, setRationale] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/exercises/${exerciseId}/document/grades`, { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { criteria?: Record<string, Array<{ id: string; text: string }>>; error?: string } | null;
        if (!live) return;
        if (!res.ok) setLoadError(data?.error ?? "The rubric did not load.");
        else setCriteria((entry.questionKey && data?.criteria?.[entry.questionKey]) || []);
      })
      .catch(() => live && setLoadError("The rubric did not load."));
    return () => {
      live = false;
    };
  }, [exerciseId, entry.questionKey]);

  // Suggest a score from the criteria the evaluator ticks. The evaluator decides.
  function toggle(id: string) {
    const next = { ...checked, [id]: !checked[id] };
    setChecked(next);
    const total = criteria?.length ?? 0;
    if (total > 0) {
      const met = Object.values(next).filter(Boolean).length;
      const suggested = Math.round((met / total) * 4);
      setScore(String(suggested));
      setRating(ratingFor(suggested));
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!rationale.trim()) {
      toast.error("Write a short rationale.");
      return;
    }
    setBusy(true);
    const r = await send(`/api/exercises/${exerciseId}/document/grades`, "POST", { responseId: entry.id, score: Number(score), rating, rationale: rationale.trim() });
    setBusy(false);
    if (!r.ok) toast.error(r.error ?? "The grade was not saved. Try again.");
    else {
      toast.success("Grade saved.");
      setRationale("");
      refresh();
    }
  }

  return (
    <div className="space-y-3 rounded-lg bg-[color:var(--color-muted)] p-3">
      <div className="space-y-1.5">
        <SectionLabel>Rubric</SectionLabel>
        {loadError && <p className="text-xs text-[color:var(--mist-danger)]">{loadError}</p>}
        {criteria === null && !loadError && <p className="text-xs text-[color:var(--color-muted-foreground)]">Loading.</p>}
        {criteria && criteria.length === 0 && <p className="text-xs text-[color:var(--color-muted-foreground)]">This question has no criteria.</p>}
        {criteria && criteria.length > 0 && (
          <ul className="space-y-1.5 text-sm">
            {criteria.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer gap-2">
                  <input type="checkbox" className="mt-1" checked={Boolean(checked[c.id])} onChange={() => toggle(c.id)} />
                  <span className="flex-1">{c.text}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      {base && (
        <div className="space-y-1">
          <SectionLabel>Current grade</SectionLabel>
          <p className="text-sm">
            {base.rating ? GRADE_RATING_LABELS[base.rating as GradeRating] : ""}, {base.score} of 4. {base.rationale}
          </p>
        </div>
      )}
      <form onSubmit={(e) => void save(e)} className="space-y-2">
        <SectionLabel>{base ? "Change the grade" : "Grade"}</SectionLabel>
        <CloudSeam feature="ai-grading" />
        <div className="grid gap-2 sm:grid-cols-2">
          <FieldSelect
            aria-label="Score"
            value={score}
            onChange={(v) => {
              setScore(v);
              setRating(ratingFor(Number(v)));
            }}
            options={SCORES.map((s) => ({ value: String(s), label: `${s} of 4` }))}
          />
          <FieldSelect
            aria-label="Rating"
            value={rating}
            onChange={(v) => setRating(v as GradeRating)}
            options={GRADE_RATINGS.map((r) => ({ value: r, label: GRADE_RATING_LABELS[r] }))}
          />
        </div>
        <Textarea aria-label="Rationale" placeholder="Why this grade." rows={2} maxLength={2000} value={rationale} onChange={(e) => setRationale(e.target.value)} />
        <div className={cn("flex justify-end")}>
          <Button size="sm" type="submit" disabled={busy || !rationale.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Save grade
          </Button>
        </div>
      </form>
    </div>
  );
}
