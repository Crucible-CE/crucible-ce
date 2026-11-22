"use client";

// The player brief: the executive brief, scope, objectives, ground rules,
// no-fault statement, stop word, and assumptions. Text only; nothing renders
// as HTML.

import type { ExerciseState } from "./types";

function Block({ label, text }: { label: string; text: string | null | undefined }) {
  if (!text?.trim()) return null;
  return (
    <section className="space-y-1">
      <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">{label}</h3>
      <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed">{text.trim()}</p>
    </section>
  );
}

/** Markdown shown as plain text: drop heading marks and emphasis, keep the words. */
function plainMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ");
}

export function hasBrief(state: ExerciseState): boolean {
  const p = state.plan;
  return Boolean(
    (state.objectives?.length ?? 0) > 0 ||
      (p && (p.executiveBriefMd || p.scope || p.groundRules || p.assumptions || p.stopWord || p.noFaultStatement)),
  );
}

export function Brief({ state }: { state: ExerciseState }) {
  const p = state.plan;
  const objectives = state.objectives ?? [];
  if (!hasBrief(state)) return <p className="py-6 text-center text-[13px] text-[color:var(--color-muted-foreground)]">No brief for this exercise.</p>;
  return (
    <div className="space-y-4 text-left">
      <Block label="Situation" text={p?.executiveBriefMd ? plainMarkdown(p.executiveBriefMd) : null} />
      <Block label="Scope" text={p?.scope} />
      {objectives.length > 0 && (
        <section className="space-y-1">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">Objectives</h3>
          <ol className="list-decimal space-y-1 pl-5 text-[13.5px] leading-relaxed">
            {objectives.map((o) => (
              <li key={o.id}>{o.text}</li>
            ))}
          </ol>
        </section>
      )}
      <Block label="Ground rules" text={p?.groundRules} />
      <Block label="No fault" text={p?.noFaultStatement} />
      {p?.stopWord && (
        <section className="space-y-1">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">Stop word</h3>
          <p className="text-[13.5px]">
            <span className="rounded bg-[color:var(--color-muted)] px-2 py-0.5 font-mono font-semibold">{p.stopWord}</span>
          </p>
          <p className="text-[12.5px] text-[color:var(--color-muted-foreground)]">Say it to stop play for a real event.</p>
        </section>
      )}
      <Block label="Assumptions and artificialities" text={p?.assumptions} />
    </div>
  );
}
