// Capability maturity: one small chart per capability, inline SVG, server
// rendered. Rows are the ratings P (top) to U (bottom); each dot is the
// objectives rated at that level in one exercise, the line joins the mean of
// each exercise. All charts share one time axis. Grid and axis text stay
// recessive; each dot has a hover title.

import { Badge } from "@/components/ui/badge";
import { RATING_LABELS, type Rating } from "@/lib/exercise/aar/schema";
import { RATING_SCORE, type MaturityRow } from "@/lib/exercise/aar/maturity";

const W = 640;
const H = 96;
const PAD = { top: 8, right: 10, bottom: 18, left: 22 };
const DAY_MS = 24 * 60 * 60 * 1000;

const RATING_COLOR: Record<Rating, string> = {
  P: "var(--mist-ok)",
  S: "var(--mist-teal)",
  M: "var(--mist-warn)",
  U: "var(--mist-danger)",
};
const RATING_VARIANT: Record<Rating, "success" | "accent" | "warning" | "destructive"> = { P: "success", S: "accent", M: "warning", U: "destructive" };
const TREND_TEXT = { improving: "Improving", declining: "Declining", stable: "Steady" } as const;
const LEVELS: Rating[] = ["P", "S", "M", "U"];

const fmt = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function MaturityLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[color:var(--color-muted-foreground)]" aria-label="Ratings">
      {LEVELS.map((r) => (
        <li key={r} className="inline-flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden="true">
            <circle cx="5" cy="5" r="4" fill={RATING_COLOR[r]} />
          </svg>
          {r} {RATING_LABELS[r]}
        </li>
      ))}
    </ul>
  );
}

function Chart({ row, start, end }: { row: MaturityRow; start: number; end: number }) {
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (iso: string) => PAD.left + ((new Date(iso).getTime() - start) / (end - start)) * iw;
  const y = (score: number) => PAD.top + ((4 - score) / 3) * ih;
  const path = row.exercises.map((e, i) => `${i ? "L" : "M"}${x(e.endedAt).toFixed(1)},${y(e.score).toFixed(1)}`).join(" ");
  // One dot per exercise and rating, sized up when it stands for several objectives.
  const dots = new Map<string, { endedAt: string; title: string; rating: Rating; objectives: string[] }>();
  for (const p of row.points) {
    const k = `${p.exerciseId}:${p.rating}`;
    const d = dots.get(k) ?? { endedAt: p.endedAt, title: p.exerciseTitle, rating: p.rating, objectives: [] };
    d.objectives.push(p.objectiveText);
    dots.set(k, d);
  }
  const label = `${row.key} ${row.name}. ${row.exercises.length} exercises. Latest ${row.latest}.`;
  return (
    <figure className="m-0 min-w-0 flex-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
        {LEVELS.map((r) => (
          <g key={r}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(RATING_SCORE[r])} y2={y(RATING_SCORE[r])} stroke="var(--color-border)" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(RATING_SCORE[r]) + 3} textAnchor="end" fontSize={10} fill="var(--color-muted-foreground)">
              {r}
            </text>
          </g>
        ))}
        <text x={PAD.left} y={H - 4} textAnchor="start" fontSize={10} fill="var(--color-muted-foreground)">
          {fmt(start)}
        </text>
        <text x={W - PAD.right} y={H - 4} textAnchor="end" fontSize={10} fill="var(--color-muted-foreground)">
          {fmt(end)}
        </text>
        {row.exercises.length > 1 && <path d={path} fill="none" stroke="var(--color-muted-foreground)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.6} />}
        {[...dots.values()].map((d) => (
          <circle key={`${d.endedAt}:${d.rating}:${d.title}`} cx={x(d.endedAt)} cy={y(RATING_SCORE[d.rating])} r={d.objectives.length > 1 ? 5.5 : 4} fill={RATING_COLOR[d.rating]} stroke="var(--color-card)" strokeWidth={1.5}>
            <title>{`${d.endedAt.slice(0, 10)} ${d.title}: ${d.rating}, ${d.objectives.length === 1 ? "1 objective" : `${d.objectives.length} objectives`}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="sr-only">{row.points.map((p) => `${p.endedAt.slice(0, 10)} ${p.exerciseTitle} ${p.rating}`).join(", ")}</figcaption>
    </figure>
  );
}

export function MaturityChart({ rows, start, end }: { rows: MaturityRow[]; start: string; end: string }) {
  let s = new Date(start).getTime();
  let e = new Date(end).getTime();
  if (e - s < 30 * DAY_MS) {
    s -= 15 * DAY_MS;
    e += 15 * DAY_MS;
  }
  return (
    <ul className="divide-y divide-[color:var(--color-border)]" data-testid="maturity">
      {rows.map((row) => (
        <li key={row.capabilityId} className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:gap-4">
          <div className="w-full shrink-0 md:w-[220px]">
            <p className="text-[13px] font-medium">
              <span className="font-mono">{row.key}</span> {row.name}
            </p>
            <p className="mt-1 flex items-center gap-2 text-[12px] text-[color:var(--color-muted-foreground)]">
              <Badge variant={RATING_VARIANT[row.latest]}>Latest {row.latest}</Badge>
              {row.trend ? TREND_TEXT[row.trend] : "One exercise"}
            </p>
          </div>
          <Chart row={row} start={s} end={e} />
        </li>
      ))}
    </ul>
  );
}
