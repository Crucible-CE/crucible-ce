// Score sanity preview for the template editor: what happens to the path if
// every team picks a given quality level on every inject. Pure; mirrors
// scoreClose: quality is looked up at the path in effect when the inject
// closes, each team's average counts once, and the inject delta is the sum of
// team averages rounded to one decimal.

import {
  DEFAULT_THRESHOLDS,
  PATH_KEYS,
  QUALITY_LEVELS,
  QUALITY_SCORES,
  pathFor,
  round1,
  type PathKey,
  type Quality,
  type TemplateInjectContent,
  type TemplateInjectSecret,
  type Thresholds,
} from "./schema";

export interface PreviewInject {
  title: string;
  targetTeams: string[];
  content: Pick<TemplateInjectContent, "questions">;
  secret: Pick<TemplateInjectSecret, "quality">;
}

export interface PreviewStep {
  seq: number;
  title: string;
  pathBefore: PathKey;
  delta: number;
  cumulative: number;
  pathAfter: PathKey;
}

export type PreviewStrategy = Quality;

/**
 * The option a team would pick for a target level at a path: an option with
 * exactly that level, else the closest by score (ties toward the worse one so
 * the preview is never rosier than the content allows).
 */
export function pickForLevel(
  options: Array<{ id: string }>,
  quality: Record<string, Partial<Record<PathKey, Quality>>>,
  path: PathKey,
  level: Quality,
): { id: string; quality: Quality } | null {
  const target = QUALITY_SCORES[level];
  let best: { id: string; quality: Quality; dist: number; score: number } | null = null;
  for (const o of options) {
    const q = quality[o.id]?.[path] ?? "neutral";
    const score = QUALITY_SCORES[q];
    const dist = Math.abs(score - target);
    if (!best || dist < best.dist || (dist === best.dist && score < best.score)) best = { id: o.id, quality: q, dist, score };
  }
  return best ? { id: best.id, quality: best.quality } : null;
}

/**
 * Simulate cumulative score and path. Every voter on a team picks the same
 * level, so the team average is that level's score whatever the team size.
 * `votersPerTeam` is kept for callers and does not change the result.
 */
export function simulateScoreArc(
  injects: PreviewInject[],
  opts: { strategy: PreviewStrategy; thresholds?: Thresholds; initialPath?: PathKey; votersPerTeam?: number },
): PreviewStep[] {
  const thresholds = opts.thresholds ?? DEFAULT_THRESHOLDS;
  let path: PathKey = opts.initialPath ?? "optimal";
  let cumulative = 0;
  const out: PreviewStep[] = [];
  injects.forEach((inj, i) => {
    let delta = 0;
    for (const q of inj.content.questions) {
      if (inj.targetTeams.length > 0 && !inj.targetTeams.includes(q.team)) continue;
      const pick = pickForLevel(q.options, inj.secret.quality[q.team] ?? {}, path, opts.strategy);
      if (pick) delta += QUALITY_SCORES[pick.quality];
    }
    const before = path;
    delta = round1(delta);
    cumulative = round1(cumulative + delta);
    path = pathFor(cumulative, thresholds);
    out.push({ seq: i + 1, title: inj.title, pathBefore: before, delta, cumulative, pathAfter: path });
  });
  return out;
}

/** All four strategies at once, for the editor table. */
export function simulateAllStrategies(
  injects: PreviewInject[],
  opts: { thresholds?: Thresholds; initialPath?: PathKey; votersPerTeam?: number } = {},
): Record<Quality, PreviewStep[]> {
  const out = {} as Record<Quality, PreviewStep[]>;
  for (const level of QUALITY_LEVELS) out[level] = simulateScoreArc(injects, { ...opts, strategy: level });
  return out;
}

export { PATH_KEYS };
