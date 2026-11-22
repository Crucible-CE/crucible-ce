// "How to build this" for Strategic TTX in Scenario Studio: the steps and a
// prompt the facilitator pastes into their own AI tool. The prompt is built
// from what is already in Studio. CE never sends it anywhere. Pure.

import { ANSWER_RATINGS, ANSWER_RATING_LABELS, PHASES } from "@/lib/exercise/modes/strategic/schema";
import { CONDITION_LABELS, MODE_CONDITIONS } from "@/lib/exercise/studio/conditions";
import { CLOCK_UPDATE_LABELS, PHASE_LABELS, STRATEGIC_LABELS as L, VARIANT_STATUS_LABELS } from "./labels";
import {
  ACCURACY_RULES,
  PLACEHOLDERS,
  anchorLabel,
  artifactKinds,
  bulletList,
  clampCount,
  clockLine,
  contextLines,
  presetClockList,
  text,
  timeExample,
  validAnchor,
  type PromptAnchor,
  type PromptClock,
} from "./prompt-parts";
import { groundedContext, groundingLines, groundingRules, resolveGrounding, type ScenarioReferenceKeys } from "./grounding";

export const STRATEGIC_DEFAULT_INJECTS = 5;

export const STRATEGIC_STEPS: readonly string[] = [
  "On the Template tab, set the title, summary, start day and time, target minutes and crisis type.",
  "Under Reference, pick a threat actor, replay or industry profile if one fits.",
  "Add two to ten teams, write the objectives and pick the regulatory clocks.",
  "Add an inject for each update. Each inject is a node on the canvas.",
  "On the Inject tab, set the title, scenario minute, planned minutes, phase and narrative. Add any artifacts.",
  "For each team, pick Active or Standby. Write what the team sees and its questions.",
  "List expected actions for each active team. Players never see them.",
  "Set the clock updates for the inject.",
  "Switch to Branched to draw branches. Drag from one node to the next and set the condition. Add an Otherwise branch where a node has conditions.",
  "Fix what the Checks tab lists.",
  "Save and publish.",
];

export interface StrategicPromptInput {
  title: string;
  summary?: string | null;
  executiveBrief?: string | null;
  crisisType?: string | null;
  teams: string[];
  targetDurationMin?: number | null;
  anchor?: PromptAnchor | null;
  clocks: PromptClock[];
  objectives: Array<{ key: string; text: string }>;
  injects: Array<{ title: string; scenarioOffsetMin: number }>;
  /** Injects to draft. */
  injectCount: number;
  /** Threat actor, replay and industry picked in the template settings. */
  reference?: ScenarioReferenceKeys | null;
}

export function buildStrategicPrompt(input: StrategicPromptInput): string {
  const anchor = validAnchor(input.anchor);
  const count = clampCount(input.injectCount, STRATEGIC_DEFAULT_INJECTS);
  const teams = input.teams.map((t) => t.trim()).filter(Boolean);
  const objectives = input.objectives.filter((o) => text(o.text));
  const summary = text(input.summary);
  const brief = text(input.executiveBrief);
  const existing = input.injects.filter((i) => text(i.title));
  const ref = resolveGrounding(input.reference);

  const have: string[] = [
    `Title: ${text(input.title) || PLACEHOLDERS.title}`,
    ...(summary ? [`Summary: ${summary}`] : []),
    ...contextLines(text(input.crisisType), groundedContext(ref)),
    `Teams: ${teams.length ? teams.join(", ") : "Not set. Use 2 to 5 teams, such as Executive, Legal, Security and Communications."}`,
    `Start day and time: ${anchorLabel(anchor)}`,
    `Target minutes: ${input.targetDurationMin ?? 90}`,
    `Injects to draft: ${count}`,
  ];
  have.push(
    input.clocks.length
      ? `Regulatory clocks:\n${bulletList(input.clocks.map(clockLine))}`
      : `Regulatory clocks: none picked yet. Pick up to 3 that fit the organization from this list and use only those, or none:\n${presetClockList()}`,
  );
  have.push(
    objectives.length
      ? `Objectives:\n${bulletList(objectives.map((o) => `${o.key}: ${text(o.text)}`))}`
      : "Objectives: none yet. Write 3 to 5.",
  );
  if (brief) have.push(`Executive brief:\n${brief}`);
  have.push(...groundingLines(ref));
  if (existing.length) {
    have.push(
      `Injects already in Studio. Keep these titles and times unless they do not fit:\n${existing
        .map((i, n) => `${n + 1}. ${text(i.title)}, scenario minute ${Math.max(0, Math.round(i.scenarioOffsetMin))}`)
        .join("\n")}`,
    );
  }

  const phases = PHASES.map((p) => PHASE_LABELS[p]).join(", ");
  const conditions = MODE_CONDITIONS.strategic.map((c) => CONDITION_LABELS[c]);
  const outcomes = ANSWER_RATINGS.map((r) => ANSWER_RATING_LABELS[r]).join(", ");
  const clockActions = `${CLOCK_UPDATE_LABELS.none}, ${CLOCK_UPDATE_LABELS.trigger} or ${CLOCK_UPDATE_LABELS.met}`;
  const statuses = `${VARIANT_STATUS_LABELS.active}, ${VARIANT_STATUS_LABELS.standby} or ${VARIANT_STATUS_LABELS.none}`;

  const rules: string[] = [
    `Write exactly ${count} injects. ${L.scenarioMinute} starts at 0 for Inject 1 and increases along every route through the branches.`,
    `${L.plannedMinutes} is the time the room spends on the inject. Along the main route it adds up to about the target minutes.`,
    "Use only the teams and regulatory clocks listed above. Do not add new ones.",
    `${L.phase} is one of: ${phases}. Use ${PHASE_LABELS.opening} for the first inject and ${PHASE_LABELS.resolution} for the last inject on each route.`,
    `${L.narrative} is the shared brief every team reads. 1 to 3 short paragraphs. Facts only: what is known, what is unknown and what is assumed. No dialogue and no drama.`,
    "A narrative must not contradict what teams may have decided earlier. Where the story depends on how teams did, use a branch to a different inject.",
    `For every team, set the status to ${statuses}. An active team answers questions. A standby team reads its brief and waits. Make at least one team active on every inject.`,
    `${L.teamSees} is one short paragraph that only this team knows or must act on.`,
    `${L.questions}: 1 to 3 for each active team. Each one asks for a decision, a priority or a trade-off that a competent executive team could answer in more than one defensible way. No trivia and no leading questions.`,
    `${L.expectedActions} are hidden from players: 2 to 4 for each active team. Each is an action an evaluator can see the team take.`,
    `${L.clockUpdates}: for each clock, ${clockActions}. Studio applies it when the inject closes. Start a clock on the inject where its trigger happens.`,
    `${L.gradingNotes} are hidden from players: one or two lines on what a strong answer covers.`,
    `${L.mitreTags}: technique IDs such as T1486 for a cyber scenario, or None.${ref.actor ? " Prefer the actor techniques listed above." : ""}`,
    `${L.artifacts} are optional, up to 6 per inject, such as the email or post the teams would see. Kind is one of: ${artifactKinds()}.`,
    `${L.condition} is one of: ${conditions.join(", ")}. ${CONDITION_LABELS.team_outcome} names a team and one of ${outcomes}. ${CONDITION_LABELS.score_below} and ${CONDITION_LABELS.score_at_least} take a score from 0 to 4.`,
    `Branches from one inject are tried from the top. When an inject has a conditional branch, it also needs one ${CONDITION_LABELS.default} branch. A branch always goes to a later inject, so there are no loops. Only Inject 1 has no branch into it. An inject with no branch out is an ${L.endNode}.`,
    "Each objective is measurable: what is done, and by when in scenario time.",
    ...groundingRules(ref),
    ...ACCURACY_RULES,
  ];

  const format: string[] = [
    L.templateTab,
    `${L.title}:`,
    `${L.summary}:`,
    `${L.startDay}:`,
    `${L.startTime}:`,
    `${L.targetMinutes}:`,
    `${L.executiveBrief}:`,
    "",
    L.teams,
    "One team per line.",
    "",
    L.objectives,
    "o1:",
    "o2:",
    "",
    L.clocks,
    "One clock per line, from the list above.",
    "",
    `${L.inject} 1`,
    `${L.title}:`,
    `${L.scenarioMinute}: ${timeExample(anchor)}`,
    `${L.plannedMinutes}:`,
    `${L.endNode}: Yes or No`,
    `${L.phase}:`,
    `${L.narrative}:`,
    `${L.artifacts}: None, or for each artifact:`,
    "  Kind:",
    `  ${L.title}:`,
    `  ${L.from}:`,
    `  ${L.sentAt}:`,
    "  Text:",
    "",
    L.teams,
    "Team: the team name",
    `Status: ${statuses}`,
    `${L.teamSees}:`,
    `${L.questions}:`,
    "1.",
    "2.",
    `${L.expectedActions}:`,
    "- action",
    "- action",
    "",
    "Repeat this block for every team.",
    "",
    L.clockUpdates,
    `Clock name: ${clockActions}`,
    "",
    `${L.gradingNotes}:`,
    `${L.mitreTags}:`,
    "",
    `Repeat from ${L.inject} 1 for ${L.inject} 2 to ${L.inject} ${count}.`,
    "",
    L.branchesTab,
    "From Inject 1",
    `${L.goTo}: Inject 2`,
    `${L.condition}:`,
    "",
    "List every branch in the order Studio should try it.",
  ];

  return [
    "You are a tabletop exercise designer. Draft a Strategic TTX that I will type by hand into Scenario Studio, where each inject is a node and branches connect the nodes.",
    "",
    "Return only the Studio inputs, field by field, as plain text. Use the headings in OUTPUT FORMAT exactly, in the same order, for every inject and every team. Do not write a story, a summary or any comment before or after the fields. Do not use tables.",
    "",
    "WHAT I HAVE SO FAR",
    ...have,
    "",
    "RULES",
    bulletList(rules),
    "",
    "OUTPUT FORMAT",
    "",
    ...format,
  ].join("\n");
}
