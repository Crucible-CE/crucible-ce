// 12-month readiness trend: one series, inline SVG, server rendered. The line
// uses the readiness ramp (--mist-ready); grid and axis text stay recessive.
// Each day has a hover target with its date and score.

import type { ReadinessTrendPoint } from "@/lib/exercise/readiness/snapshot";

const W = 640;
const H = 160;
const PAD = { top: 10, right: 12, bottom: 22, left: 30 };
const DAY_MS = 24 * 60 * 60 * 1000;

export function ReadinessTrend({ points, now }: { points: ReadinessTrendPoint[]; now: string }) {
  if (points.length === 0) {
    return <p className="text-[13px] text-[color:var(--color-muted-foreground)]">The first snapshot is taken tonight.</p>;
  }
  const end = new Date(`${now.slice(0, 10)}T00:00:00Z`).getTime();
  const start = end - 365 * DAY_MS;
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (day: string) => PAD.left + ((new Date(`${day}T00:00:00Z`).getTime() - start) / (end - start)) * iw;
  const y = (score: number) => PAD.top + (1 - score / 100) * ih;
  const shown = points.filter((p) => new Date(`${p.day}T00:00:00Z`).getTime() >= start);
  const path = shown.map((p, i) => `${i ? "L" : "M"}${x(p.day).toFixed(1)},${y(p.score).toFixed(1)}`).join(" ");
  const last = shown[shown.length - 1];
  const months = Array.from({ length: 5 }, (_, i) => new Date(start + (i * (end - start)) / 4));
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Readiness score over 12 months. Latest ${last?.score ?? "none"}.`}>
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--color-border)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--color-muted-foreground)">
              {v}
            </text>
          </g>
        ))}
        {months.map((m, i) => (
          <text key={i} x={PAD.left + (i * iw) / 4} y={H - 6} textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"} fontSize={10} fill="var(--color-muted-foreground)">
            {fmt(m)}
          </text>
        ))}
        {shown.length > 1 && <path d={path} fill="none" stroke="var(--mist-ready)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {last && <circle cx={x(last.day)} cy={y(last.score)} r={4} fill="var(--mist-ready)" stroke="var(--color-card)" strokeWidth={2} />}
        {shown.map((p) => (
          <circle key={p.day} cx={x(p.day)} cy={y(p.score)} r={7} fill="transparent" className="cursor-default">
            <title>{`${p.day}: ${p.score}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="sr-only">
        {shown.map((p) => `${p.day} ${p.score}`).join(", ")}
      </figcaption>
    </figure>
  );
}
