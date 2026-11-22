// "How to write the AAR": the after-action steps in HSEEP order, and a
// prompt for the facilitator's own AI tool with the exercise record filled
// in. Names become roles. CE sends the prompt nowhere; the facilitator copies
// each part of the answer into the matching field. Pure.
//
//   const prompt = buildAarPrompt(aarPromptInput(inputs, sections));

import { scenarioLabel, formatInZone } from "@/lib/exercise/time";
import type { AarInputs } from "./inputs";
import { nameReplacerFor } from "./draft";
import { allFindings, sourcesText } from "./findings";
import { gradeLabel } from "./proposals";
import { AAR_FIELD_LABELS as F } from "./field-labels";
import { NOT_EVALUATED_LABEL, RATING_LABELS, type AarSections, type Rating } from "./schema";

export const AAR_GUIDE_STEPS: readonly string[] = [
  "Run the hotwash right after ENDEX. Record strengths and areas for improvement.",
  "Hold the controller and evaluator debrief.",
  "Rate each objective P, S, M or U, or mark it Not evaluated with a reason.",
  "Collect participant feedback.",
  "Review the proposed findings on the Findings tab. Accept or reject each one.",
  "Write the executive summary.",
  "Write the strengths and the accepted areas for improvement: observation, analysis and recommendation. Keep them no-fault and about plans and capabilities, not people. Artificialities are not areas for improvement.",
  "For each accepted area for improvement, create a work item or record why no action is needed.",
  "Hold the after-action meeting. Record the date, the attendees and when the improvement plan was agreed.",
  "Confirm attendance on the roster.",
  "Move the report to review.",
  "Sign as facilitator, then the sponsor signs.",
  "Export the evidence bundle.",
];

export interface AarPromptInput {
  exercise: {
    title: string;
    modeLabel: string;
    startedAt: string | null;
    durationMin: number | null;
    timezone: string;
    scenarioStartAt: string | null;
    scope: string;
    hazard: string;
    scenarioSummary: string;
    assumptions: string;
  };
  objectives: Array<{ id: string; text: string; capabilities: string[]; rating: string }>;
  decisions: Array<{ seq: number; time: string; team: string; owner: string; question: string; decision: string }>;
  clocks: Array<{ label: string; statement: string }>;
  observations: Array<{ where: string; kind: string; text: string }>;
  hotwash: Array<{ kind: string; where: string; text: string }>;
  grades: string[];
  feedback: string[];
  proposed: Array<{ id: string; title: string; where: string; sources: string; observation: string }>;
}

const OBS_KIND: Record<string, string> = { observation: "Observation", strength: "Strength", afi: "Area for improvement" };
const HOTWASH_KIND: Record<string, string> = { strength: "Strength", afi: "Area for improvement", parking_lot: "Parking lot" };

function ratingText(a: AarSections["analysis"][number]): string {
  if (a.notEvaluated) return `${NOT_EVALUATED_LABEL}. Reason: ${a.ratingRationale || "Not recorded"}`;
  if (!a.rating) return "Not rated yet";
  const r = `${a.rating}: ${RATING_LABELS[a.rating as Rating]}`;
  return a.ratingRationale ? `${r}. Rationale: ${a.ratingRationale}` : r;
}

/** The record for the prompt, names replaced by roles. Pure. */
export function aarPromptInput(inputs: AarInputs, sections: AarSections): AarPromptInput {
  const replace = nameReplacerFor(inputs);
  const t = (s: string | null | undefined) => replace((s ?? "").trim().replace(/\s+/g, " "));
  const objNo = new Map(sections.analysis.map((a, i) => [a.objectiveId, i + 1]));
  const injSeq = new Map(inputs.injects.map((i) => [i.id, i]));
  const where = (objectiveId: string | null, injectId?: string | null, role?: string | null) =>
    [objectiveId && objNo.has(objectiveId) ? `Objective ${objNo.get(objectiveId)}` : "", injectId && injSeq.has(injectId) ? `Inject ${injSeq.get(injectId)!.seq}` : "", role ? t(role) : ""]
      .filter(Boolean)
      .join(", ");
  const capName = new Map(inputs.objectives.flatMap((o) => o.capabilities.map((c) => [c.key, c.name] as const)));
  const tz = inputs.exercise.timezone;

  const grades: string[] = [];
  const byInject = new Map<string, Map<string, number>>();
  for (const r of inputs.responses) {
    if (r.ratingSource !== "human" || !r.rating) continue;
    const m = byInject.get(r.injectId) ?? new Map<string, number>();
    const label = gradeLabel(r.rating);
    m.set(label, (m.get(label) ?? 0) + 1);
    byInject.set(r.injectId, m);
  }
  for (const [injectId, m] of byInject) {
    const inj = injSeq.get(injectId);
    grades.push(`${inj ? `Inject ${inj.seq}. ${t(inj.title)}` : "Inject"}: ${[...m].map(([k, n]) => `${k} ${n}`).join(", ")}`);
  }

  return {
    exercise: {
      title: t(inputs.exercise.title),
      modeLabel: inputs.exercise.modeLabel,
      startedAt: inputs.exercise.startedAt,
      durationMin: inputs.exercise.durationMin,
      timezone: tz,
      scenarioStartAt: inputs.exercise.scenarioStartAt,
      scope: t(inputs.exercise.scope),
      hazard: t(inputs.exercise.hazard),
      scenarioSummary: t(inputs.exercise.scenarioSummary),
      assumptions: t(inputs.exercise.assumptions),
    },
    objectives: sections.analysis.map((a) => ({
      id: a.objectiveId,
      text: t(a.objectiveText),
      capabilities: a.capabilityKeys.map((k) => (capName.get(k) ? `${k} ${capName.get(k)}` : k)),
      rating: t(ratingText(a)),
    })),
    decisions: sections.decisionLog.map((d) => ({
      seq: d.seq,
      time: scenarioLabel(d.scenarioTime, inputs.exercise.scenarioStartAt, tz) ?? "",
      team: d.team ?? "",
      owner: t(d.owner),
      question: t(d.question),
      decision: t(d.decision),
    })),
    clocks: sections.clocks.map((c) => ({ label: c.label, statement: t(c.statement) })),
    observations: inputs.observations.filter((o) => o.text.trim()).map((o) => ({ where: where(o.objectiveId, o.injectId, o.authorRole), kind: OBS_KIND[o.kind] ?? o.kind, text: t(o.text) })),
    hotwash: inputs.hotwash.filter((h) => h.text.trim()).map((h) => ({ kind: HOTWASH_KIND[h.kind] ?? h.kind, where: where(h.objectiveId), text: t(h.text) })),
    grades,
    feedback: inputs.feedback.improvements.map((f) => t(f.text)).filter(Boolean),
    proposed: allFindings(sections)
      .filter((f) => f.afi.status === "proposed")
      .map((f) => ({
        id: f.afi.id,
        title: t(f.afi.title),
        where: f.objectiveId ? `Objective ${objNo.get(f.objectiveId)}` : "No objective yet",
        sources: sourcesText(f.afi.sources),
        observation: t(f.afi.observation),
      })),
  };
}

/** No em or en dashes anywhere in the prompt. */
function plain(s: string): string {
  return s.replace(/[–—]/g, "-");
}

export function buildAarPrompt(input: AarPromptInput): string {
  const e = input.exercise;
  const lines: string[] = [];
  const push = (...l: string[]) => lines.push(...l);
  let n = 0;
  const item = () => `[E${++n}]`;

  push(
    "You are helping write the after-action report (AAR) for a cybersecurity exercise. Follow the HSEEP after-action report structure.",
    "",
    "Rules",
    "- Use HSEEP terms: objective, capability, strength, area for improvement, observation, analysis, recommendation.",
    "- Findings are no-fault. Write about plans, processes and capabilities, not people.",
    "- Not observed is not a failure. An objective the exercise did not exercise is Not evaluated.",
    "- U means the team attempted the task and could not perform it.",
    "- Exercise artificialities are not areas for improvement.",
    "- Cite only evidence from the record below, by its item number, for example [E3].",
    "- Do not invent facts, times, names or numbers. If the record does not say, leave it out.",
    "- Do not use real names. Use roles or titles.",
    "",
    "Exercise record",
    "",
    "Exercise overview",
    `Name: ${e.title}`,
    `Type: ${e.modeLabel}`,
    `Started: ${e.startedAt ? formatInZone(new Date(e.startedAt), e.timezone) : "Not recorded"}`,
    `Duration: ${e.durationMin !== null ? `${e.durationMin} minutes` : "Not recorded"}`,
  );
  if (e.scope) push(`Scope: ${e.scope}`);
  if (e.hazard) push(`Threat or hazard: ${e.hazard}`);
  if (e.scenarioSummary) push(`Scenario: ${e.scenarioSummary}`);
  if (e.assumptions) push(`Assumptions and artificialities: ${e.assumptions}`);

  push("", "Objectives");
  if (!input.objectives.length) push("None.");
  input.objectives.forEach((o, i) => {
    push(`${F.objective} ${i + 1}. ${o.text}`);
    if (o.capabilities.length) push(`${F.capability}: ${o.capabilities.join("; ")}`);
    push(`Rating: ${o.rating}`);
  });

  push("", "Decision log (scenario time)");
  if (!input.decisions.length) push("None recorded.");
  for (const d of input.decisions) {
    const who = [d.team, d.owner].filter(Boolean).join(", ");
    push(`${item()} Inject ${d.seq}${d.time ? `, ${d.time}` : ""}${who ? `, ${who}` : ""}: ${[d.question, d.decision].filter(Boolean).join(" Decision: ")}`);
  }

  push("", "Regulatory clock outcomes");
  if (!input.clocks.length) push("None.");
  for (const c of input.clocks) push(`- ${c.label}: ${c.statement}`);

  push("", "Evaluator observations");
  if (!input.observations.length) push("None recorded.");
  for (const o of input.observations) push(`${item()} ${o.kind}${o.where ? ` (${o.where})` : ""}: ${o.text}`);

  push("", "Hotwash");
  if (!input.hotwash.length) push("None recorded.");
  for (const h of input.hotwash) push(`${item()} ${h.kind}${h.where ? ` (${h.where})` : ""}: ${h.text}`);

  push("", "Grades");
  if (!input.grades.length) push("None recorded.");
  for (const g of input.grades) push(`- ${g}`);

  push("", "Participant feedback, improvements");
  if (!input.feedback.length) push("None recorded.");
  for (const f of input.feedback) push(`${item()} ${f}`);

  push("", "Proposed findings");
  if (!input.proposed.length) push("None.");
  input.proposed.forEach((p, i) => {
    push(`[F${i + 1}] ${p.title} (${p.where}. Source: ${p.sources || "Written"})`);
    if (p.observation && p.observation !== p.title) push(`${F.observation}: ${p.observation}`);
  });

  push(
    "",
    "What to write",
    "Answer in plain text, field by field, with the labels below. The facilitator copies each field into the report by hand.",
    "",
    `${F.executiveSummary}:`,
    "Five to eight sentences.",
    "",
    "Then, for each objective:",
    `${F.objective} <number>`,
    `${F.strengths}`,
    `${F.strength}: <one strength>`,
    `${F.evidence}: <item numbers, for example [E2]>`,
    `${F.afis}`,
    `${F.title}: <short statement>`,
    `${F.observation}: <what happened, from the record>`,
    `${F.analysis}: <why it happened and its effect>`,
    `${F.recommendation}: <what to change in the plan, process or capability>`,
    `${F.capability}: <capability key and name>`,
    `${F.evidence}: <item numbers>`,
    "",
    "Then, for each proposed finding:",
    "[F<number>]: Accept or Reject",
    "Reason: <one sentence. Reject artificialities and findings the record does not support.>",
  );
  return plain(lines.join("\n"));
}
