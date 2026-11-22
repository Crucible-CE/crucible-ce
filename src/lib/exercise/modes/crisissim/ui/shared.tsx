"use client";

import { AlertTriangle, ChevronDown, FileText, Mail, MessageSquare, Mic, Newspaper, ScrollText, Share2, Skull } from "lucide-react";
import { cn } from "@/lib/utils";
import { ARTIFACT_KIND_LABELS, PATH_LABELS, QUALITY_DISPLAY, type Artifact, type PathKey, type Quality } from "../schema";
import { SafeMarkdown } from "./markdown";
import type { CsClock, CsState } from "./types";

export const PATH_TONE: Record<PathKey, { text: string; bg: string; dot: string }> = {
  optimal: {
    text: "text-[color:var(--mist-ok)]",
    bg: "bg-[color:color-mix(in_srgb,var(--mist-ok),transparent_88%)]",
    dot: "var(--mist-ok)",
  },
  degrading: {
    text: "text-[color:var(--mist-warn)]",
    bg: "bg-[color:color-mix(in_srgb,var(--mist-warn),transparent_88%)]",
    dot: "var(--mist-warn)",
  },
  critical: {
    text: "text-[color:var(--mist-danger)]",
    bg: "bg-[color:color-mix(in_srgb,var(--mist-danger),transparent_88%)]",
    dot: "var(--mist-danger)",
  },
};

/** No-fault labels; control screens may be projected. */
export const QUALITY_LABEL: Record<Quality, string> = QUALITY_DISPLAY;
export const QUALITY_TONE: Record<Quality, string> = {
  great: "text-[color:var(--mist-ok)]",
  good: "text-[color:var(--mist-teal)]",
  neutral: "text-[color:var(--color-muted-foreground)]",
  bad: "text-[color:var(--mist-danger)]",
};

export function PathBadge({ path, className }: { path: PathKey; className?: string }) {
  const tone = PATH_TONE[path];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", tone.bg, tone.text, className)}>
      <span className="h-2 w-2 rounded-full" style={{ background: tone.dot }} aria-hidden />
      {PATH_LABELS[path]}
    </span>
  );
}

/**
 * Weekday, time and zone in the instance timezone from the projection, never
 * the browser's. Falls back to UTC when the zone is unknown.
 */
/** Node and browsers disagree on "GMT" and "GMT+0"; use one spelling. */
const zoneName = (n: string) => (/^(GMT|UTC)[+-]0(:00)?$/.test(n) ? n.slice(0, 3) : n);

export function formatZoned(at: string | Date, timezone: string | undefined): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" };
  const d = typeof at === "string" ? new Date(at) : at;
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: timezone || "UTC" });
  } catch {
    fmt = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" });
  }
  const part = (type: Intl.DateTimeFormatPartTypes) => fmt.formatToParts(d).find((p) => p.type === type)?.value ?? "";
  // "Sat 02:10 UTC"
  return `${part("weekday")} ${part("hour")}:${part("minute")} ${zoneName(part("timeZoneName"))}`.trim();
}

/** "T+6h 10m, Sat 02:10 UTC" from the exercise scenario start. */
export function scenarioLabel(state: Pick<CsState, "exercise" | "timezone">, at: string | null): string | null {
  if (!at) return null;
  const start = state.exercise.scenarioStartAt ? new Date(state.exercise.scenarioStartAt).getTime() : null;
  const t = new Date(at);
  const clock = formatZoned(t, state.timezone);
  if (start === null) return clock;
  const min = Math.max(0, Math.round((t.getTime() - start) / 60_000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  const rel = [d ? `${d}d` : "", h ? `${h}h` : "", m || (!d && !h) ? `${m}m` : ""].filter(Boolean).join(" ");
  return `T+${rel}, ${clock}`;
}

const ARTIFACT_ICON: Record<Artifact["kind"], typeof Mail> = {
  email: Mail,
  social_post: Share2,
  news: Newspaper,
  ransom_note: Skull,
  regulator_letter: ScrollText,
  chat: MessageSquare,
  voicemail: Mic,
  document: FileText,
  log_excerpt: FileText,
};

const ARTIFACT_STYLE: Partial<Record<Artifact["kind"], string>> = {
  ransom_note: "border-l-[color:var(--mist-danger)]",
  regulator_letter: "border-l-[color:var(--mist-navy)]",
  social_post: "border-l-[color:var(--mist-teal)]",
  news: "border-l-[color:var(--mist-ink-3)]",
  email: "border-l-[color:var(--mist-ink-4)]",
};

export function ArtifactCard({ artifact, defaultOpen = false }: { artifact: Artifact; defaultOpen?: boolean }) {
  const Icon = ARTIFACT_ICON[artifact.kind] ?? FileText;
  return (
    <details
      open={defaultOpen}
      className={cn(
        "group rounded-lg border border-[color:var(--color-border)] border-l-4 bg-[color:var(--color-card)]",
        ARTIFACT_STYLE[artifact.kind] ?? "border-l-[color:var(--color-border)]",
      )}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <Icon className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{artifact.title}</span>
          <span className="block truncate text-xs text-[color:var(--color-muted-foreground)]">
            {ARTIFACT_KIND_LABELS[artifact.kind]}
            {artifact.from ? ` from ${artifact.from}` : ""}
            {artifact.sentAt ? `, ${artifact.sentAt}` : ""}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div
        className={cn(
          "border-t border-[color:var(--color-border)] px-3 py-3 text-sm",
          artifact.kind === "log_excerpt" && "font-mono text-xs",
          artifact.kind === "ransom_note" && "font-mono",
        )}
      >
        {artifact.kind === "log_excerpt" ? (
          <pre className="overflow-x-auto whitespace-pre-wrap break-words">{artifact.content}</pre>
        ) : (
          <SafeMarkdown text={artifact.content} />
        )}
      </div>
    </details>
  );
}

const CLOCK_STATUS: Record<CsClock["status"], { label: string; tone: string }> = {
  pending: { label: "Not started", tone: "text-[color:var(--color-muted-foreground)]" },
  running: { label: "Running", tone: "text-[color:var(--mist-warn)]" },
  met: { label: "Met", tone: "text-[color:var(--mist-ok)]" },
  missed: { label: "Missed", tone: "text-[color:var(--mist-danger)]" },
};

function clockStatus(c: CsClock) {
  if (c.outcome === "open") return { label: "Open at ENDEX", tone: "text-[color:var(--mist-warn)]" };
  return CLOCK_STATUS[c.status];
}

export function ClockList({ clocks, state }: { clocks: CsClock[]; state: Pick<CsState, "exercise" | "timezone"> }) {
  if (!clocks.length) return null;
  return (
    <ul className="space-y-2">
      {clocks.map((c) => {
        const s = clockStatus(c);
        return (
          <li key={c.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
            <span className="font-medium">{c.label}</span>
            <span className={cn("text-xs font-semibold", s.tone)}>
              {c.status === "missed" && <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden />}
              {s.label}
            </span>
            {c.deadlineAt && (
              <span className="w-full text-xs text-[color:var(--color-muted-foreground)]">
                {c.status === "met" && c.metAt ? `Met at ${scenarioLabel(state, c.metAt)}. ` : ""}
                Due {scenarioLabel(state, c.deadlineAt)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-muted-foreground)]">{children}</h3>;
}

export function teamNameOf(state: Pick<CsState, "teams">, teamId: string | null | undefined): string {
  return state.teams.find((t) => t.id === teamId)?.name ?? "No team";
}
