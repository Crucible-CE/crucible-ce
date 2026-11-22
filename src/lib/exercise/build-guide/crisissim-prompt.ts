// "How to build this" for the Crisis Sim template editor: the steps and a
// prompt the facilitator pastes into their own AI tool. The prompt is built
// from what is already in the editor. CE never sends it anywhere. Pure.

import { REGULATORY_CLOCK_PRESETS } from "@/lib/exercise/content/regulatory-clocks";
import { DEFAULT_THRESHOLDS, DELIVERABLE_LABELS, OPTION_TRIGGER_CLOCKS, PATH_KEYS, PATH_LABELS, QUALITY_LEVELS } from "@/lib/exercise/modes/crisissim/schema";
import { CRISISSIM_LABELS as L, OPTION_CLOCK_LABELS, QUALITY_LABELS, QUESTION_TYPE_LABELS } from "./labels";
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

export const CRISISSIM_DEFAULT_INJECTS = 6;

export const CRISISSIM_STEPS: readonly string[] = [
  "Under Scenario, set the title, summary, path thresholds, target minutes, start day and start time.",
  "Under Reference, pick a threat actor, replay or industry profile if one fits.",
  "Add the teams, pick the regulatory clocks and write the objectives.",
  "Add an inject. Set its title, scenario minutes, planned minutes, target teams and ATT&CK tags.",
  "Pick the clocks that start when the inject opens.",
  "Write the narrative for each path: On track, Under strain and Escalating. Add the consequence and any artifacts.",
  "For each team, write the question and set the decision owner, the type (Standard, Materiality or Ransom) and a discussion prompt.",
  "Write four options. Rate each option on every path, then add its follow-up, rationale and any clock effect.",
  "List two to four expected actions for each team.",
  "Turn on Written task if a team writes something. Set the kind, the prompt and the grading criteria.",
  "Repeat for every inject. Check Score preview and Problems.",
  "Save and publish. Publish lists anything still missing.",
];

export interface CrisisSimPromptInput {
  title: string;
  summary?: string | null;
  /** Fictional organization name in the template, if set. */
  orgName?: string | null;
  executiveBrief?: string | null;
  teams: string[];
  thresholds: { optimal: number; degrading: number };
  targetDurationMin?: number | null;
  anchor?: PromptAnchor | null;
  clocks: PromptClock[];
  objectives: Array<{ key: string; text: string }>;
  injects: Array<{ title: string; scenarioOffsetMin: number }>;
  /** Injects to draft. */
  injectCount: number;
  /** Threat actor, replay and industry picked in scenario settings. */
  reference?: ScenarioReferenceKeys | null;
}

function clockRules(selected: PromptClock[]): string[] {
  const pool = selected.length ? selected : REGULATORY_CLOCK_PRESETS;
  const optionStarts = pool.filter((c) => OPTION_TRIGGER_CLOCKS.includes(c.key)).map((c) => c.label);
  const injectStarts = pool.filter((c) => !OPTION_TRIGGER_CLOCKS.includes(c.key)).map((c) => c.label);
  const rules: string[] = [];
  if (injectStarts.length) {
    rules.push(
      `These clocks start when an inject opens, so list them under ${L.injectClocks} on the inject where the trigger happens: ${injectStarts.join(", ")}. An option can only meet them.`,
    );
  }
  if (optionStarts.length) {
    rules.push(`Only an option can start these clocks: ${optionStarts.join(", ")}. Use ${OPTION_CLOCK_LABELS.trigger} on the option that makes the decision.`);
  }
  rules.push(
    `For each option, list only the clocks it changes, each as ${OPTION_CLOCK_LABELS.trigger} or ${OPTION_CLOCK_LABELS.met}. ${OPTION_CLOCK_LABELS.met} means the option meets that clock, for example by filing the notice. Leave the rest out.`,
  );
  return rules;
}

export function buildCrisisSimPrompt(input: CrisisSimPromptInput): string {
  const anchor = validAnchor(input.anchor);
  const count = clampCount(input.injectCount, CRISISSIM_DEFAULT_INJECTS);
  const teams = input.teams.map((t) => t.trim()).filter(Boolean);
  const objectives = input.objectives.filter((o) => text(o.text));
  const th = input.thresholds;
  const defaultThresholds = th.optimal === DEFAULT_THRESHOLDS.optimal && th.degrading === DEFAULT_THRESHOLDS.degrading;
  const summary = text(input.summary);
  const brief = text(input.executiveBrief);
  const org = text(input.orgName);
  const existing = input.injects.filter((i) => text(i.title));
  const ref = resolveGrounding(input.reference);

  const have: string[] = [
    `Title: ${text(input.title) || PLACEHOLDERS.title}`,
    ...(summary ? [`Summary: ${summary}`] : []),
    ...(org ? [`Organization name used in the exercise: ${org}`] : []),
    ...contextLines("", groundedContext(ref)),
    `Teams: ${teams.length ? teams.join(", ") : "Not set. Use 3 or 4 teams, such as Executive, Legal, Security and Communications."}`,
    `Start day and time: ${anchorLabel(anchor)}`,
    `Target minutes: ${input.targetDurationMin ?? 60}`,
    `Injects to draft: ${count}`,
    `${L.thresholdOptimal}: ${th.optimal}. ${L.thresholdCritical}: ${th.degrading}.`,
  ];
  have.push(
    input.clocks.length
      ? `Regulatory clocks:\n${bulletList(input.clocks.map(clockLine))}`
      : `Regulatory clocks: none picked yet. Pick up to 3 that fit the organization from this list and use only those:\n${presetClockList()}`,
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
      `Injects already in the editor. Keep these titles and times unless they do not fit:\n${existing
        .map((i, n) => `${n + 1}. ${text(i.title)}, scenario minute ${Math.max(0, Math.round(i.scenarioOffsetMin))}`)
        .join("\n")}`,
    );
  }

  const ratings = QUALITY_LEVELS.map((q) => QUALITY_LABELS[q]).join(", ");
  const types = Object.values(QUESTION_TYPE_LABELS).join(", ");
  const kinds = Object.values(DELIVERABLE_LABELS).join(", ");
  const [onTrack, strain, escalating] = PATH_KEYS.map((p) => PATH_LABELS[p]);

  const rules: string[] = [
    `Write exactly ${count} injects. Scenario minutes start at 0 for Inject 1 and increase from one inject to the next. Space them over the hours or days a real incident would take.`,
    `Planned minutes is the time the room spends on the inject. Across all injects it adds up to about the target minutes.`,
    "Use only the teams and regulatory clocks listed above. Do not add new ones.",
    "Each inject targets one or more teams. Write one question for every target team.",
    `There are three paths. ${onTrack} is how the inject reads when teams have decided well so far, ${strain} when decisions have been mixed, and ${escalating} when they have gone badly. The same events happen on every path. The pressure and the damage differ.`,
    "Each narrative is 1 to 3 short paragraphs. Facts only: what is known, what is unknown and what is assumed. No dialogue and no drama.",
    "Narratives must not contradict earlier decisions, because teams may have picked any option. Put what follows from one choice in that option's Follow-up, which teams see at the start of the next inject.",
    `${L.consequence} is one or two sentences on what this path means for the organization right now.`,
    "Each question has 4 options, A to D. Every option is a plausible choice a competent executive could defend. Keep the options a similar length. At most one option may be clearly improper. The best option must not be the only long or multi-step one.",
    `Write each rating as one of: ${ratings}. These mean great, good, neutral and bad. Use no other values.`,
    `Every question has at least one option rated ${QUALITY_LABELS.great} or ${QUALITY_LABELS.good} on every path.`,
    `A rating may differ by path. An action that is ${QUALITY_LABELS.great} early can be ${QUALITY_LABELS.neutral} on ${escalating} because it comes too late.`,
    `${L.rationale} is one line on why the option has its ratings. Players see it only in the debrief.`,
    `${L.type} is one of: ${types}. Use Materiality for the question where a team decides whether the incident is material. Use Ransom for the question on paying a ransom. Use Standard for the rest.`,
    `${L.decisionOwner} is a role, such as Chief Executive Officer or General Counsel, never a person's name.`,
    `${L.discussionPrompt} is one question that gets the team talking before it votes.`,
    ...clockRules(input.clocks),
    `${L.expectedActions}: 2 to 4 for each target team. Each is an action an evaluator can see the team take.`,
    `${L.writtenTask} is optional, for one team on an inject. ${L.kind} is one of: ${kinds}. Give 2 to 5 grading criteria.`,
    `${L.artifacts} are optional, up to 6 per path, such as the email or post the team would see. ${L.kind} is one of: ${artifactKinds()}.`,
    defaultThresholds
      ? `Keep ${L.thresholdOptimal} ${th.optimal} and ${L.thresholdCritical} ${th.degrading} unless I say otherwise.`
      : `Keep ${L.thresholdOptimal} ${th.optimal} and ${L.thresholdCritical} ${th.degrading}.`,
    `${L.attackTags} are hidden from players: the technique IDs the inject exercises, or None.${ref.actor ? " Prefer the actor techniques listed above." : ""}`,
    "Each objective is measurable: what is done, and by when in scenario time.",
    ...groundingRules(ref),
    ...ACCURACY_RULES,
  ];

  const artifactBlock = [`${L.artifacts}: None, or for each artifact:`, `  ${L.kind}:`, `  ${L.title}:`, `  ${L.from}:`, `  ${L.text}:`];
  const pathBlock = (label: string) => [label, `${L.narrative}:`, `${L.consequence}:`, ...artifactBlock, ""];
  const option = (id: string) => [
    `${id}: the option text`,
    `  ${onTrack}:`,
    `  ${strain}:`,
    `  ${escalating}:`,
    `  ${L.followUp}:`,
    `  ${L.rationale}:`,
    `  Clocks: None, or the clock name and ${OPTION_CLOCK_LABELS.trigger} or ${OPTION_CLOCK_LABELS.met}`,
  ];

  const format: string[] = [
    L.scenario,
    `${L.title}:`,
    `${L.summary}:`,
    `${L.thresholdOptimal}:`,
    `${L.thresholdCritical}:`,
    `${L.targetMinutes}:`,
    `${L.startDay}:`,
    `${L.startTime}:`,
    `${L.executiveBrief}:`,
    "",
    L.teams,
    "One team per line.",
    "",
    L.clocks,
    "One clock per line, from the list above.",
    "",
    L.objectives,
    "o1:",
    "o2:",
    "",
    `${L.inject} 1`,
    `${L.title}:`,
    `${L.scenarioMinutes}: ${timeExample(anchor)}`,
    `${L.plannedMinutes}:`,
    `${L.targetTeams}:`,
    `${L.injectClocks}: None, or the clock names`,
    `${L.objectives}: the objective keys this inject tests`,
    `${L.attackTags}: None, or technique IDs such as T1486`,
    "",
    L.narrative,
    "",
    ...pathBlock(onTrack),
    ...pathBlock(strain),
    ...pathBlock(escalating),
    L.questions,
    "",
    `${L.team}: the team name`,
    `${L.question}:`,
    `${L.decisionOwner}:`,
    `${L.type}:`,
    `${L.discussionPrompt}:`,
    L.options,
    ...["A", "B", "C", "D"].flatMap(option),
    "",
    "Repeat this block for every target team.",
    "",
    L.expectedActions,
    "Team name:",
    "- action",
    "- action",
    "",
    `${L.writtenTask}: Off, or:`,
    `  ${L.team}:`,
    `  ${L.kind}:`,
    `  ${L.prompt}:`,
    `  ${L.gradingCriteria}:`,
    "  - criterion",
    "",
    `Repeat from ${L.inject} 1 for ${L.inject} 2 to ${L.inject} ${count}.`,
  ];

  return [
    "You are a tabletop exercise designer. Draft a Crisis Sim decision exercise that I will type by hand into a template editor.",
    "",
    "Return only the editor inputs, field by field, as plain text. Use the headings in OUTPUT FORMAT exactly, in the same order, for every inject and every team. Do not write a story, a summary or any comment before or after the fields. Do not use tables.",
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
