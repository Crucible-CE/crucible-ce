// Readiness scorecard: a rule-based 0 to 100 score with a per-component
// breakdown. No AI. Every input comes from records CE already keeps.
//
// Ported from Crucible Cloud's scorecard (src/app/api/readiness in Cloud:
// exercise readiness, ATT&CK coverage, work item health), widened to the
// exercise program CE runs. Cloud's AI-derived inputs (threat briefing,
// document analysis) are left out. Incidents do not feed the score, as in
// Cloud.
//
// Each component scores 0 to 100. A component with nothing to measure (for
// example no required roles in policy) is not counted, and the weights of the
// rest are scaled to 100. Bump RUBRIC_VERSION when a weight or rule changes so
// stored snapshots stay attributable.

export const RUBRIC_VERSION = 1;

export const READINESS_COMPONENTS = [
  { key: "cadence", label: "Exercise cadence", weight: 20 },
  { key: "roles", label: "Required roles", weight: 15 },
  { key: "ratings", label: "Objective ratings", weight: 15 },
  { key: "workItems", label: "Work items", weight: 20 },
  { key: "aarTimeliness", label: "Report timeliness", weight: 10 },
  { key: "attack", label: "ATT&CK techniques", weight: 10 },
  { key: "playbooks", label: "Playbooks", weight: 10 },
] as const;

export type ReadinessComponentKey = (typeof READINESS_COMPONENTS)[number]["key"];

if (READINESS_COMPONENTS.reduce((n, c) => n + c.weight, 0) !== 100) {
  throw new Error("Readiness weights must sum to 100.");
}

/** Points per rating: Performed 100, Some challenges 67, Major challenges 33, Unable 0. */
export const RATING_POINTS: Record<string, number> = { P: 100, S: 67, M: 33, U: 0 };

/** Distinct techniques in 12 months for full ATT&CK credit (Cloud uses a fixed target too). */
export const ATTACK_TARGET = 20;

/** Open work items older than this count as stale. */
export const STALE_ITEM_DAYS = 90;

/** Open high-priority items at which that part of the work item score is zero. */
export const HIGH_PRIORITY_CAP = 5;

export interface ReadinessInputs {
  /** Cadence rows from the program report: one per framework requirement. */
  cadence: Array<{ status: "current" | "due_soon" | "overdue" | "never" }>;
  /** Non-practice exercises ended in the last 12 months. */
  exercisesLast12: number;
  /** Required roles from policy, with how many of those exercises had each. */
  roles: Array<{ role: string; present: number; total: number }>;
  /** Latest evaluator rating per objective, in the last 12 months, with the exercise end date. */
  ratings: Array<{ rating: string; endedAt: Date }>;
  workItems: { open: number; overdue: number; openHigh: number; stale: number };
  /** Ended exercises in 12 months, and how many of those have a report past due. */
  aar: { ended: number; overdue: number };
  /** Distinct ATT&CK techniques on delivered injects in the last 12 months. */
  techniques: number;
  /**
   * Playbooks in Documents. own: added or duplicated. exercised: own playbooks
   * behind an exercise that ended in 12 months. run: own playbooks run on an
   * incident in 12 months. used: own playbooks in either.
   */
  playbooks: { total: number; own: number; exercised: number; run: number; used: number };
}

export interface ReadinessComponent {
  key: ReadinessComponentKey;
  label: string;
  weight: number;
  /** 0 to 100, or null when not counted. */
  score: number | null;
  /** Points toward the total after weights are scaled. 0 when not counted. */
  points: number;
  explanation: string;
}

export interface ReadinessResult {
  score: number;
  rubricVersion: number;
  components: ReadinessComponent[];
  /** Objective ratings: last 6 months against the 6 before. Null without both halves. */
  ratingsTrend: "up" | "down" | "flat" | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const clamp = (n: number) => Math.max(0, Math.min(100, n));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Scored = { score: number | null; explanation: string };

export function scoreCadence(i: Pick<ReadinessInputs, "cadence" | "exercisesLast12">): Scored {
  if (i.cadence.length === 0) {
    return i.exercisesLast12 > 0
      ? { score: 100, explanation: "No cadence set. An exercise ended in the last 12 months." }
      : { score: 0, explanation: "No cadence set and no exercise in the last 12 months." };
  }
  const met = i.cadence.filter((c) => c.status === "current" || c.status === "due_soon").length;
  return { score: clamp((met / i.cadence.length) * 100), explanation: `${met} of ${i.cadence.length} cadence requirements are current.` };
}

export function scoreRoles(i: Pick<ReadinessInputs, "roles" | "exercisesLast12">): Scored {
  if (i.roles.length === 0) return { score: null, explanation: "No required roles in policy." };
  if (i.exercisesLast12 === 0) return { score: 0, explanation: "No exercise in the last 12 months." };
  const shares = i.roles.map((r) => (r.total > 0 ? r.present / r.total : 0));
  const full = i.roles.filter((r) => r.total > 0 && r.present === r.total).length;
  return {
    score: clamp((shares.reduce((a, b) => a + b, 0) / shares.length) * 100),
    explanation: `${full} of ${i.roles.length} required roles attended every exercise.`,
  };
}

export function ratingsTrend(ratings: ReadinessInputs["ratings"], now: Date): ReadinessResult["ratingsTrend"] {
  const mid = now.getTime() - 182 * DAY_MS;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const points = (r: { rating: string }) => RATING_POINTS[r.rating];
  const recent = avg(ratings.filter((r) => r.endedAt.getTime() >= mid && points(r) !== undefined).map(points));
  const earlier = avg(ratings.filter((r) => r.endedAt.getTime() < mid && points(r) !== undefined).map(points));
  if (recent === null || earlier === null) return null;
  if (recent - earlier >= 5) return "up";
  if (earlier - recent >= 5) return "down";
  return "flat";
}

export function scoreRatings(ratings: ReadinessInputs["ratings"], now: Date): Scored {
  const rated = ratings.filter((r) => RATING_POINTS[r.rating] !== undefined);
  if (rated.length === 0) return { score: null, explanation: "No objective ratings in the last 12 months." };
  const score = rated.reduce((n, r) => n + RATING_POINTS[r.rating], 0) / rated.length;
  const trend = ratingsTrend(rated, now);
  const trendText = trend === "up" ? " Improving." : trend === "down" ? " Declining." : trend === "flat" ? " Steady." : "";
  const performed = rated.filter((r) => r.rating === "P").length;
  return { score: clamp(score), explanation: `P on ${performed} of ${rated.length} ratings.${trendText}` };
}

export function scoreWorkItems(w: ReadinessInputs["workItems"]): Scored {
  if (w.open === 0) return { score: 100, explanation: "No open work items." };
  const onTime = 1 - Math.min(w.overdue, w.open) / w.open;
  const fresh = 1 - Math.min(w.stale, w.open) / w.open;
  const high = 1 - Math.min(w.openHigh, HIGH_PRIORITY_CAP) / HIGH_PRIORITY_CAP;
  return {
    score: clamp(onTime * 50 + fresh * 30 + high * 20),
    explanation: `${plural(w.open, "open item")}: ${w.overdue} overdue, ${w.stale} over ${STALE_ITEM_DAYS} days, ${w.openHigh} high priority.`,
  };
}

export function scoreAarTimeliness(a: ReadinessInputs["aar"]): Scored {
  if (a.ended === 0) return { score: null, explanation: "No exercise ended in the last 12 months." };
  const onTime = a.ended - Math.min(a.overdue, a.ended);
  return { score: clamp((onTime / a.ended) * 100), explanation: `Reports on time for ${onTime} of ${a.ended} exercises.` };
}

export function scoreAttack(techniques: number): Scored {
  return {
    score: clamp((Math.min(techniques, ATTACK_TARGET) / ATTACK_TARGET) * 100),
    explanation: `${plural(techniques, "technique")} exercised in 12 months. Target ${ATTACK_TARGET}.`,
  };
}

/** 30 for any playbook, 30 for one of your own (added or duplicated), 40 by the share of your own exercised or run on an incident in 12 months. */
export function scorePlaybooks(p: ReadinessInputs["playbooks"]): Scored {
  if (p.total === 0) return { score: 0, explanation: "No playbooks in Documents." };
  const used = Math.min(p.used, p.own);
  const ownShare = p.own > 0 ? used / p.own : 0;
  const score = 30 + (p.own > 0 ? 30 : 0) + ownShare * 40;
  const explanation =
    p.own === 0
      ? `${plural(p.total, "library playbook")}. None duplicated or added.`
      : `${used} of ${plural(p.own, "own playbook")} used in 12 months: ${p.exercised} exercised, ${p.run} run on an incident.`;
  return { score: clamp(score), explanation };
}

/** The weighted score and its breakdown. Pure. */
export function computeReadiness(i: ReadinessInputs, now: Date = new Date()): ReadinessResult {
  const scored: Record<ReadinessComponentKey, Scored> = {
    cadence: scoreCadence(i),
    roles: scoreRoles(i),
    ratings: scoreRatings(i.ratings, now),
    workItems: scoreWorkItems(i.workItems),
    aarTimeliness: scoreAarTimeliness(i.aar),
    attack: scoreAttack(i.techniques),
    playbooks: scorePlaybooks(i.playbooks),
  };
  const counted = READINESS_COMPONENTS.filter((c) => scored[c.key].score !== null);
  const countedWeight = counted.reduce((n, c) => n + c.weight, 0);
  const components: ReadinessComponent[] = READINESS_COMPONENTS.map((c) => {
    const s = scored[c.key];
    const points = s.score === null || countedWeight === 0 ? 0 : (s.score * c.weight) / countedWeight;
    return {
      key: c.key,
      label: c.label,
      weight: c.weight,
      score: s.score === null ? null : Math.round(s.score),
      points: Number(points.toFixed(2)),
      explanation: s.explanation,
    };
  });
  const total = components.reduce((n, c) => n + c.points, 0);
  return {
    score: Math.round(clamp(total)),
    rubricVersion: RUBRIC_VERSION,
    components,
    ratingsTrend: ratingsTrend(i.ratings, now),
  };
}
