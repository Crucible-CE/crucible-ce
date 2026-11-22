"use client";

// Projector view of a Document TTX exercise: the current module in large
// type. No entries, grades, expected actions or facilitator notes. Follows
// the exercise live through the shared state hook.

import { Loader2 } from "lucide-react";
import { useExerciseState } from "@/components/exercise/use-exercise-state";
import { SafeMarkdown } from "@/components/markdown/safe-markdown";

interface PresenterModule {
  id: string;
  seq: number;
  status: string;
  title: string;
  scenarioUpdate: string;
  keyIssues: string[];
  questions: Array<{ key: string; text: string }>;
}

export function Presenter({ exerciseId }: { exerciseId: string }) {
  const s = useExerciseState(exerciseId, { guest: false });
  const state = s.state as (typeof s.state & { injects?: PresenterModule[]; current?: string | null; modulesTotal?: number | null }) | null;

  if (!state) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        {s.error ? <p className="text-xl text-[color:var(--mist-danger)]">{s.error}</p> : <Loader2 className="h-8 w-8 animate-spin text-[color:var(--color-muted-foreground)]" />}
      </div>
    );
  }
  const ex = state.exercise;
  const modules = (state.injects ?? []) as PresenterModule[];
  const current = modules.find((m) => m.id === state.current) ?? null;

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-10 px-10 py-12">
      <header className="flex items-baseline justify-between gap-6 text-[color:var(--color-muted-foreground)]">
        <p className="truncate text-2xl">{ex.title}</p>
        {current && (
          <p className="shrink-0 text-2xl">
            Module {current.seq}
            {state.modulesTotal ? ` of ${state.modulesTotal}` : ""}
          </p>
        )}
      </header>

      {ex.status === "draft" || ex.status === "lobby" ? (
        <p className="text-4xl font-semibold">The exercise starts soon.</p>
      ) : ex.status === "ended" || ex.status === "abandoned" ? (
        <p className="text-4xl font-semibold">ENDEX</p>
      ) : !current ? (
        <p className="text-4xl font-semibold">Waiting for the first module.</p>
      ) : (
        <>
          <h1 className="font-display text-6xl font-semibold leading-tight tracking-tight">{current.title}</h1>
          {ex.status === "paused" && <p className="text-3xl text-[color:var(--mist-warn)]">Paused</p>}
          <SafeMarkdown text={current.scenarioUpdate} className="text-3xl leading-snug" />
          {current.keyIssues.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xl font-semibold uppercase tracking-wide text-[color:var(--color-muted-foreground)]">Key issues</h2>
              <ul className="list-disc space-y-2 pl-8 text-3xl">
                {current.keyIssues.map((k, i) => (
                  <li key={i}>{k}</li>
                ))}
              </ul>
            </section>
          )}
          {current.questions.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xl font-semibold uppercase tracking-wide text-[color:var(--color-muted-foreground)]">Questions</h2>
              <ol className="space-y-4 text-3xl">
                {current.questions.map((q, i) => (
                  <li key={q.key} className="flex gap-4">
                    <span className="font-mono text-[color:var(--color-muted-foreground)]">{i + 1}.</span>
                    <span>{q.text}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}
    </main>
  );
}
