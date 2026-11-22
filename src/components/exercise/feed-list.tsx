"use client";

import { formatClock } from "@/lib/exercise/time";
import { END_REASON_LABELS, type FeedEntry } from "./types";

const PATH_FEED_LABELS: Record<string, string> = { optimal: "On track", degrading: "Under strain", critical: "Escalating" };

function str(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

/** One line (and an optional detail line) for a feed event. */
export function describeEvent(e: FeedEntry, teamName: (id: string) => string | null, player = false): { title: string; detail?: string } {
  const d = e.data;
  // Players read "Update"; control reads "Inject".
  const noun = player ? "Update" : "Inject";
  switch (e.type) {
    case "created":
      return { title: "Exercise created" };
    case "lobby_opened":
      return { title: "Lobby opened" };
    case "lobby_closed":
      return { title: "Lobby closed" };
    case "startex":
      return { title: "STARTEX" };
    case "endex":
      return { title: "ENDEX", detail: END_REASON_LABELS[str(d.reason)] };
    case "paused":
      return { title: "Paused" };
    case "resumed":
      return { title: "Resumed" };
    case "inject_released":
      return { title: d.seq ? `${noun} ${str(d.seq)} opened` : `${noun} released`, detail: str(d.title) || undefined };
    case "inject_held":
      return { title: `Inject ${str(d.seq)} waiting for release`, detail: str(d.title) || undefined };
    case "inject_closed":
      return { title: `Inject ${str(d.seq)} closed`, detail: d.trigger ? `Trigger ${str(d.trigger).replace("_", " ")}` : undefined };
    case "inject_discarded":
      return { title: "Held inject discarded" };
    case "inject_extended":
      return { title: `Inject extended by ${Math.round(Number(d.addMs ?? 0) / 60_000)} min` };
    case "broadcast": {
      const team = str(d.teamId) ? teamName(str(d.teamId)) : null;
      return { title: team ? `Message to ${team}` : "Message to everyone", detail: str(d.message) };
    }
    case "path_shift":
      return {
        title: `Path now ${PATH_FEED_LABELS[str(d.to)] ?? str(d.to)}`,
        detail: d.scoreAfter !== undefined ? `Score ${str(d.scoreBefore)} to ${str(d.scoreAfter)}` : undefined,
      };
    case "ransom_decision":
      return { title: `${str(d.team)} decision on ransom`, detail: str(d.majorityText) || "No decision" };
    case "sop_rating":
      return { title: "SOP rating", detail: str(d.rating).replace(/_/g, " ") || undefined };
    case "questions_unanswered":
      return { title: "Questions left unanswered", detail: Array.isArray(d.keys) ? `${d.keys.length} question${d.keys.length === 1 ? "" : "s"}` : undefined };
    case "teams_no_answer":
      return { title: "No answer from some teams", detail: Array.isArray(d.teams) ? d.teams.join(", ") : undefined };
    case "config_changed":
      return { title: "Settings changed" };
    case "clock_triggered":
      return { title: `${str(d.label) || "Regulatory"} clock started` };
    case "clock_met":
      return { title: `${str(d.label) || "Regulatory"} clock ${d.onTime ? "met on time" : "missed"}` };
    case "clock_reset":
      return { title: `${str(d.label) || "Regulatory"} clock reset` };
    case "clock_missed":
      return { title: `${str(d.label) || "Regulatory"} clock missed` };
    case "participant_excused":
      return { title: `${str(d.displayName)} excused` };
    case "decision":
    case "materiality_decision":
      return {
        title: `${str(d.team)} decision${e.type === "materiality_decision" ? " on materiality" : ""}`,
        detail: str(d.majorityText) || "No decision",
      };
    case "participant_joined":
      return { title: `${str(d.displayName)} joined` };
    case "participant_removed":
      return { title: `${str(d.displayName)} removed` };
    case "advance_failed":
      return { title: "The next inject did not load", detail: "Try Advance again." };
    default:
      return { title: e.type.replace(/_/g, " ") };
  }
}

export function FeedList({
  feed,
  teams,
  timezone,
  emptyText = "Nothing has happened yet.",
  player = false,
}: {
  feed: FeedEntry[];
  teams: Array<{ id: string; name: string }>;
  timezone: string;
  emptyText?: string;
  /** Player wording ("Update" for injects). */
  player?: boolean;
}) {
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? null;
  if (feed.length === 0) return <p className="py-6 text-center text-[13px] text-[color:var(--color-muted-foreground)]">{emptyText}</p>;
  return (
    <ol className="space-y-2" aria-label="Exercise feed">
      {[...feed].reverse().map((e) => {
        const { title, detail } = describeEvent(e, teamName, player);
        return (
          <li key={e.id} className="flex gap-3 rounded-md bg-[color:var(--color-muted)]/60 px-3 py-2">
            <time className="shrink-0 pt-px font-mono text-[11.5px] tabular-nums text-[color:var(--color-muted-foreground)]" dateTime={e.at}>
              {formatClock(new Date(e.at), timezone)}
            </time>
            <div className="min-w-0 text-[13px]">
              <div className="font-medium">{title}</div>
              {detail && <div className="whitespace-pre-wrap break-words text-[color:var(--color-muted-foreground)]">{detail}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
