"use client";

// Control room main area. The shell header owns pause, next, release,
// discard, close, extend, broadcast and ENDEX. This view adds what is
// specific to Strategic TTX: a held inject with edits, every team's variant
// with expected actions, answers with the evaluator rating, who the room is
// waiting on, contingency injects with a fog of war picker, and SimCell
// messages to one team.

import { useMemo, useState } from "react";
import { ChevronDown, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { CloudSeam } from "@/components/cloud/cloud-seam";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldSelect } from "@/components/form/field-select";
import { SafeMarkdown } from "@/components/markdown/safe-markdown";
import { FOG_EVENTS } from "@/lib/exercise/content/fog";
import { ANSWER_RATINGS, ANSWER_RATING_LABELS, type AnswerRating } from "../schema";
import { InjectBody, Notice, RatingBadge, SectionLabel, injectLine, postJson, useGradeDetails } from "./shared";
import { asState, type ModeViewProps, type StControlAnswer, type StGradeDetail, type StInject, type StState, type StVariant } from "./types";

export function ControlView(props: ModeViewProps) {
  const state = asState(props.state);
  const gradeCount = state?.injects.reduce((n, i) => n + (i.control?.answers.reduce((m, a) => m + a.grades.length, 0) ?? 0), 0) ?? 0;
  const details = useGradeDetails(props.exerciseId, Boolean(state?.viewer.isControl), gradeCount);
  if (!state) return <Notice text="Loading the exercise." />;

  const current = state.injects.find((i) => i.id === state.current) ?? null;
  const earlier = state.injects.filter((i) => i.status === "closed" && i.id !== current?.id).sort((a, b) => b.seq - a.seq);
  const live = state.exercise.status === "live";
  const busy = state.injects.some((i) => i.status === "open" || i.status === "held");
  const delivered = state.injects.filter((i) => !i.contingency).length;
  const total = state.injectTotal;

  return (
    <div className="space-y-4 pb-10">
      <p className="text-sm text-[color:var(--color-muted-foreground)]">
        {delivered ? (total ? `Update ${delivered} of ${total}` : `Update ${delivered}`) : "No update yet"}
        {state.config.winCondition === "dynamic" ? ". Ends early when every active team is effective on two updates in a row." : "."}
      </p>

      {!current && <Notice text={live ? "Advance to send the first update." : "Start the exercise to send the first update."} />}

      {current?.status === "held" && <HeldEditor key={current.id} state={state} inject={current} act={props.act} />}

      {current && current.status !== "held" && (
        <div className="space-y-4">
          <InjectBody state={state} inject={current}>
            {current.status === "open" && current.control && (
              <p className="text-sm">
                {current.control.waitingOn.length ? (
                  <>
                    <span className="font-medium">Waiting on </span>
                    {current.control.waitingOn.join(", ")}.
                  </>
                ) : current.progress.required > 0 ? (
                  "Every active team has answered."
                ) : (
                  "No team needs to answer this update."
                )}
              </p>
            )}
          </InjectBody>
          <TeamBoard exerciseId={props.exerciseId} state={state} inject={current} grades={details.grades} onGraded={details.reload} />
        </div>
      )}

      {state.viewer.isDriver && (live || state.exercise.status === "paused") && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ContingencyForm exerciseId={props.exerciseId} state={state} blocked={busy} refresh={props.refresh} />
          <SimCell state={state} act={props.act} />
        </div>
      )}

      {earlier.length > 0 && (
        <section className="space-y-2">
          <SectionLabel>Earlier updates</SectionLabel>
          {earlier.map((i) => (
            <details key={i.id} className="group rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)]">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{i.title}</span>
                  <span className="block text-xs text-[color:var(--color-muted-foreground)]">{injectLine(state, i)}</span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="space-y-3 border-t border-[color:var(--color-border)] p-4">
                <SafeMarkdown text={i.narrativeMd} className="text-sm" />
                <TeamBoard exerciseId={props.exerciseId} state={state} inject={i} grades={details.grades} onGraded={details.reload} />
              </div>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Held inject: preview, edit, release, discard
// ---------------------------------------------------------------------------

function HeldEditor({ state, inject, act }: { state: StState; inject: StInject; act: ModeViewProps["act"] }) {
  const [title, setTitle] = useState(inject.title);
  const [narrative, setNarrative] = useState(inject.narrativeMd);
  const [variants, setVariants] = useState<StVariant[]>(inject.variants ?? []);
  const [busy, setBusy] = useState<"release" | "discard" | null>(null);
  const expected = inject.control?.expectedActions ?? {};

  const setVariant = (idx: number, patch: Partial<StVariant>) => setVariants((vs) => vs.map((v, i) => (i === idx ? { ...v, ...patch } : v)));

  async function release() {
    setBusy("release");
    const edited = title !== inject.title || narrative !== inject.narrativeMd || JSON.stringify(variants) !== JSON.stringify(inject.variants ?? []);
    const content = {
      schemaVersion: 1,
      narrativeMd: narrative.trim(),
      phase: inject.phase,
      artifacts: inject.artifacts,
      teamVariants: variants.map((v) => ({ ...v, questions: v.status === "standby" ? [] : v.questions.filter((q) => q.text.trim().length >= 5) })),
      contingency: inject.contingency,
    };
    const r = await act("release", { injectId: inject.id, ...(edited ? { edits: { title: title.trim(), content } } : {}) });
    setBusy(null);
    if (!r.ok) toast.error(r.error ?? "The inject was not released. Try again.");
    else toast.success("Released.");
  }

  async function discard() {
    setBusy("discard");
    const r = await act("discard", { injectId: inject.id });
    setBusy(null);
    if (!r.ok) toast.error(r.error ?? "The inject was not discarded. Try again.");
    else toast.success("Discarded.");
  }

  return (
    <Card className="gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="warning">Waiting for release</Badge>
        <span className="text-xs text-[color:var(--color-muted-foreground)]">{injectLine(state, inject)}. Players cannot see it yet.</span>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="held-title">Title</Label>
        <Input id="held-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="held-narrative">Shared update</Label>
        <Textarea id="held-narrative" rows={8} maxLength={8000} value={narrative} onChange={(e) => setNarrative(e.target.value)} />
      </div>
      {inject.artifacts.length > 0 && (
        <p className="text-xs text-[color:var(--color-muted-foreground)]">
          {inject.artifacts.length} artifact{inject.artifacts.length === 1 ? "" : "s"}: {inject.artifacts.map((a) => a.title).join(", ")}.
        </p>
      )}
      <div className="space-y-3">
        <SectionLabel>Team variants</SectionLabel>
        {variants.map((v, idx) => (
          <div key={v.teamId ?? v.team} className="space-y-2 rounded-md border border-[color:var(--color-border)] p-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium">{v.team}</span>
              <FieldSelect
                aria-label={`${v.team} status`}
                className="h-9 w-36"
                value={v.status}
                onChange={(s) => setVariant(idx, { status: s as StVariant["status"] })}
                options={[
                  { value: "active", label: "Active" },
                  { value: "standby", label: "Standby" },
                ]}
              />
            </div>
            <Textarea aria-label={`${v.team} brief`} rows={3} maxLength={4000} value={v.narrativeMd} onChange={(e) => setVariant(idx, { narrativeMd: e.target.value })} />
            {v.status === "active" && (
              <Textarea
                aria-label={`${v.team} questions, one per line`}
                rows={Math.max(2, v.questions.length)}
                value={v.questions.map((q) => q.text).join("\n")}
                onChange={(e) =>
                  setVariant(idx, {
                    questions: e.target.value
                      .split("\n")
                      .slice(0, 5)
                      .map((text, i) => ({ key: v.questions[i]?.key ?? `q${i + 1}`, text })),
                  })
                }
                placeholder="One question per line."
              />
            )}
            {(expected[v.team]?.length ?? 0) > 0 && (
              <div className="text-xs text-[color:var(--color-muted-foreground)]">
                <span className="font-semibold">Expected actions. </span>
                {expected[v.team]!.join(" ")}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="accent" disabled={busy !== null || state.exercise.status !== "live" || !title.trim() || narrative.trim().length < 10} onClick={() => void release()}>
          {busy === "release" && <Loader2 className="h-4 w-4 animate-spin" />}
          Release
        </Button>
        <Button variant="outline" disabled={busy !== null} onClick={() => void discard()}>
          {busy === "discard" && <Loader2 className="h-4 w-4 animate-spin" />}
          Discard
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Teams, answers and grades
// ---------------------------------------------------------------------------

function TeamBoard({ exerciseId, state, inject, grades, onGraded }: { exerciseId: string; state: StState; inject: StInject; grades: StGradeDetail[]; onGraded: () => void }) {
  const variants = inject.variants ?? [];
  const c = inject.control;
  if (!c) return null;
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {variants.map((v) => {
        const answer = c.answers.find((a) => a.teamId === v.teamId) ?? null;
        return <TeamCard key={v.teamId ?? v.team} exerciseId={exerciseId} state={state} inject={inject} variant={v} expected={c.expectedActions[v.team] ?? []} answer={answer} grades={grades} onGraded={onGraded} />;
      })}
    </div>
  );
}

function TeamCard(props: {
  exerciseId: string;
  state: StState;
  inject: StInject;
  variant: StVariant;
  expected: string[];
  answer: StControlAnswer | null;
  grades: StGradeDetail[];
  onGraded: () => void;
}) {
  const { variant: v, answer, inject } = props;
  const humanDetail = answer ? [...props.grades].reverse().find((g) => g.responseId === answer.responseId && g.source === "human") : undefined;
  const waiting = inject.status === "open" && v.status === "active" && !answer;
  return (
    <Card dense className="h-fit gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{v.team}</span>
        <Badge variant={v.status === "active" ? "accent" : "secondary"}>{v.status === "active" ? "Active" : "Standby"}</Badge>
        {waiting && <Badge variant="warning">Waiting</Badge>}
        {answer?.effective && <RatingBadge rating={answer.effective.rating} score={answer.effective.score} source={answer.effective.source} />}
        {answer && !answer.effective && inject.status === "closed" && <Badge variant="outline">Not rated</Badge>}
      </div>
      <SafeMarkdown text={v.narrativeMd} className="text-sm text-[color:var(--color-muted-foreground)]" />
      {v.questions.length > 0 && (
        <ol className="list-decimal space-y-0.5 pl-5 text-sm">
          {v.questions.map((q) => (
            <li key={q.key}>{q.text}</li>
          ))}
        </ol>
      )}
      {props.expected.length > 0 && (
        <div className="space-y-1">
          <SectionLabel>Expected actions</SectionLabel>
          <ul className="space-y-1 text-sm">
            {props.expected.map((a, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[color:var(--color-border)]" aria-hidden />
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {answer && (
        <div className="space-y-1">
          <SectionLabel>Answer{answer.by ? ` from ${answer.by}` : ""}</SectionLabel>
          <p className="whitespace-pre-wrap rounded-md bg-[color:var(--color-muted)] p-3 text-sm">{answer.text}</p>
        </div>
      )}
      {humanDetail && (
        <p className="text-xs text-[color:var(--color-muted-foreground)]">
          <span className="font-semibold">Evaluator rationale. </span>
          {humanDetail.rationale}
        </p>
      )}
      {answer && inject.status === "closed" && props.state.viewer.isControl && (
        <OverrideForm exerciseId={props.exerciseId} answer={answer} onSaved={props.onGraded} />
      )}
    </Card>
  );
}

function OverrideForm({ exerciseId, answer, onSaved }: { exerciseId: string; answer: StControlAnswer; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<AnswerRating>((answer.effective?.rating as AnswerRating) ?? "partially_effective");
  const [score, setScore] = useState(String(answer.effective?.score ?? 2));
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="self-start" onClick={() => setOpen(true)}>
        Set the rating
      </Button>
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await postJson(`/api/strategic/${exerciseId}/grades`, { responseId: answer.responseId, score: Number(score), rating, rationale: rationale.trim() });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error ?? "The rating was not saved. Try again.");
      return;
    }
    toast.success("Rating saved.");
    setOpen(false);
    setRationale("");
    onSaved();
  }

  return (
    <form onSubmit={save} className="space-y-2 rounded-md border border-[color:var(--color-border)] p-3">
      <CloudSeam feature="ai-grading" />
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor={`rating-${answer.responseId}`}>Rating</Label>
          <FieldSelect
            id={`rating-${answer.responseId}`}
            className="h-9"
            value={rating}
            onChange={(v) => setRating(v as AnswerRating)}
            options={ANSWER_RATINGS.map((r) => ({ value: r, label: ANSWER_RATING_LABELS[r] }))}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`score-${answer.responseId}`}>Score</Label>
          <FieldSelect
            id={`score-${answer.responseId}`}
            className="h-9"
            value={score}
            onChange={setScore}
            options={["0", "0.5", "1", "1.5", "2", "2.5", "3", "3.5", "4"].map((s) => ({ value: s, label: `${s} of 4` }))}
          />
        </div>
      </div>
      <Label htmlFor={`why-${answer.responseId}`}>Rationale</Label>
      <Textarea id={`why-${answer.responseId}`} rows={2} maxLength={2000} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="What the team's answer did or missed." />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="accent" disabled={busy || !rationale.trim()}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Save rating
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Contingency inject
// ---------------------------------------------------------------------------

function ContingencyForm({ exerciseId, state, blocked, refresh }: { exerciseId: string; state: StState; blocked: boolean; refresh: () => void }) {
  const [fog, setFog] = useState("");
  const [title, setTitle] = useState("");
  const [narrative, setNarrative] = useState("");
  const [questions, setQuestions] = useState("");
  const [teams, setTeams] = useState<string[]>(() => state.teams.map((t) => t.id));
  const [busy, setBusy] = useState(false);

  function pickFog(key: string) {
    setFog(key);
    const f = FOG_EVENTS.find((x) => x.key === key);
    if (!f) return;
    setTitle(f.title);
    setNarrative(f.description);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await postJson(`/api/strategic/${exerciseId}/contingency`, {
      title: title.trim(),
      narrativeMd: narrative.trim(),
      targetTeamIds: teams,
      questions: questions
        .split("\n")
        .map((q) => q.trim())
        .filter(Boolean)
        .slice(0, 3),
    });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error ?? "The contingency inject was not sent. Try again.");
      return;
    }
    toast.success("Contingency inject sent.");
    setFog("");
    setTitle("");
    setNarrative("");
    setQuestions("");
    refresh();
  }

  const fogOptions = useMemo(() => [{ value: "", label: "Write your own" }, ...FOG_EVENTS.map((f) => ({ value: f.key, label: f.title }))], []);
  const effect = FOG_EVENTS.find((f) => f.key === fog)?.effect;

  return (
    <Card dense className="h-fit gap-3">
      <SectionLabel>Contingency inject</SectionLabel>
      {blocked && <p className="text-xs text-[color:var(--color-muted-foreground)]">Close or release the current inject first.</p>}
      <form onSubmit={send} className="space-y-2">
        <div className="space-y-1">
          <Label htmlFor="cont-fog">Fog of war</Label>
          <FieldSelect id="cont-fog" className="h-9" value={fog} onChange={pickFog} options={fogOptions} />
          {effect && <p className="text-xs text-[color:var(--color-muted-foreground)]">{effect}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="cont-title">Title</Label>
          <Input id="cont-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cont-narrative">What happens</Label>
          <Textarea id="cont-narrative" rows={4} maxLength={8000} value={narrative} onChange={(e) => setNarrative(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cont-questions">Questions, one per line</Label>
          <Textarea id="cont-questions" rows={2} value={questions} onChange={(e) => setQuestions(e.target.value)} placeholder="Leave empty to send it for awareness only." />
        </div>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Teams</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {state.teams.map((t) => (
              <label key={t.id} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={teams.includes(t.id)}
                  onChange={(e) => setTeams((cur) => (e.target.checked ? [...cur, t.id] : cur.filter((x) => x !== t.id)))}
                />
                {t.name}
              </label>
            ))}
          </div>
        </fieldset>
        <Button type="submit" size="sm" variant="accent" disabled={busy || blocked || !title.trim() || narrative.trim().length < 10 || teams.length === 0}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Send inject
        </Button>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// SimCell: an outside voice to one team, sent as a team broadcast
// ---------------------------------------------------------------------------

const SIMCELL_ROLES = ["Media", "Regulator", "Board", "Law enforcement", "Customer", "Insurer", "Vendor"] as const;

function SimCell({ state, act }: { state: StState; act: ModeViewProps["act"] }) {
  const [role, setRole] = useState<string>(SIMCELL_ROLES[0]);
  const [teamId, setTeamId] = useState<string>(state.teams[0]?.id ?? "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    // The control broadcast has no sender field, so the role leads the text.
    const r = await act("broadcast", { message: `${role}: ${text.trim()}`.slice(0, 1000), teamId: teamId || null });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error ?? "The message was not sent. Try again.");
      return;
    }
    toast.success("Sent.");
    setText("");
  }

  return (
    <Card dense className="h-fit gap-3">
      <SectionLabel>SimCell message</SectionLabel>
      <form onSubmit={send} className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="sim-role">From</Label>
            <FieldSelect id="sim-role" className="h-9" value={role} onChange={setRole} options={SIMCELL_ROLES.map((r) => ({ value: r, label: r }))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sim-team">To</Label>
            <FieldSelect
              id="sim-team"
              className="h-9"
              value={teamId}
              onChange={setTeamId}
              options={[...state.teams.map((t) => ({ value: t.id, label: t.name })), { value: "", label: "Everyone" }]}
            />
          </div>
        </div>
        <Textarea aria-label="Message" rows={3} maxLength={900} value={text} onChange={(e) => setText(e.target.value)} placeholder="What the caller says." />
        <Button type="submit" size="sm" variant="outline" disabled={busy || !text.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send
        </Button>
      </form>
    </Card>
  );
}
