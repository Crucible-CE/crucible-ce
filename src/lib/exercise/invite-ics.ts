// Calendar invite for one exercise. Pure: built on the schedule ICS writer
// (src/lib/exercise/schedule/ics.ts), which escapes every TEXT value and folds lines.

import { buildIcsCalendar, markdownToPlain } from "@/lib/exercise/schedule/ics";

export interface ExerciseInviteIcsInput {
  exerciseId: string;
  title: string;
  start: Date;
  /** Time box in minutes. Null uses one hour. */
  durationMin: number | null;
  /** Join link and code, when join by code is on. */
  join: { url: string; code: string } | null;
  /** Link to the exercise for people with an account, used when there is no join link. */
  exerciseUrl: string | null;
  /** Pre-read brief (markdown). */
  briefMd: string | null;
  now?: Date;
}

export const DEFAULT_INVITE_MINUTES = 60;

export function exerciseInviteDescription(v: Pick<ExerciseInviteIcsInput, "join" | "exerciseUrl" | "briefMd">): string {
  const parts: string[] = [];
  if (v.join) parts.push(`Join: ${v.join.url}\nCode: ${v.join.code}`);
  else if (v.exerciseUrl) parts.push(`Open: ${v.exerciseUrl}`);
  if (v.briefMd?.trim()) parts.push(`Pre-read\n\n${markdownToPlain(v.briefMd)}`);
  return parts.join("\n\n");
}

export function exerciseInviteIcs(v: ExerciseInviteIcsInput): string {
  return buildIcsCalendar({
    name: v.title,
    now: v.now,
    events: [
      {
        uid: `exercise-${v.exerciseId}`,
        title: v.title,
        start: v.start,
        durationMinutes: v.durationMin && v.durationMin > 0 ? v.durationMin : DEFAULT_INVITE_MINUTES,
        description: exerciseInviteDescription(v),
        url: v.join?.url ?? v.exerciseUrl,
      },
    ],
  });
}
