// Evidence an evaluator can attach to a strength or an area for improvement:
// observations, answers, entries, votes and decisions from the exercise
// record. Each option keeps its row id, so a chip in the report points back to
// the record it quotes. Pure.

import type { AarInputs } from "./inputs";
import type { Evidence } from "./schema";

export interface EvidenceOption {
  kind: Evidence["kind"];
  sourceId: string;
  /** Inject number, team or author role: where it came from. */
  context: string;
  /** The quote stored on the chip. */
  quote: string;
  at: string | null;
  speakerRole: string | null;
}

const QUOTE_MAX = 1200;

function clip(s: string): string {
  const v = s.trim().replace(/\s+/g, " ");
  return v.length > QUOTE_MAX ? `${v.slice(0, QUOTE_MAX - 3).trimEnd()}...` : v;
}

export function evidenceOptions(inputs: Pick<AarInputs, "observations" | "responses" | "decisions" | "injects">): EvidenceOption[] {
  const seq = new Map(inputs.injects.map((i) => [i.id, i.seq]));
  const where = (injectId: string | null, extra: Array<string | null>) =>
    [injectId && seq.has(injectId) ? `Inject ${seq.get(injectId)}` : null, ...extra].filter(Boolean).join(", ");
  const out: EvidenceOption[] = [];
  for (const o of inputs.observations) {
    if (!o.text.trim()) continue;
    out.push({ kind: "observation", sourceId: o.id, context: where(o.injectId, [o.authorRole]), quote: clip(o.text), at: o.at, speakerRole: o.authorRole });
  }
  for (const r of inputs.responses) {
    if (!r.text.trim()) continue;
    out.push({ kind: r.sourceKind, sourceId: r.sourceId, context: where(r.injectId, [r.team, r.role]), quote: clip(r.text), at: r.at, speakerRole: r.role });
  }
  for (const d of inputs.decisions) {
    if (d.sourceKind !== "event" || !d.decision?.trim()) continue;
    out.push({ kind: "event", sourceId: d.sourceId, context: where(d.injectId, [d.team, d.owner]), quote: clip(d.decision), at: d.at, speakerRole: d.owner });
  }
  return out.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
}

/** The chip stored in the report for an option. */
export function evidenceFromOption(o: EvidenceOption): Evidence {
  return {
    kind: o.kind,
    sourceId: o.sourceId,
    quote: o.quote,
    ...(o.at ? { at: o.at } : {}),
    ...(o.speakerRole ? { speakerRole: o.speakerRole.slice(0, 120) } : {}),
  };
}
