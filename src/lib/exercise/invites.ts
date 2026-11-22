// Invite participants by email and by calendar file. Server only.
//
// Email addresses live only in memory for the send. They are never stored,
// never audited (the audit row gets counts) and never logged: a send failure
// logs the transport error code only, because SMTP error text often quotes
// the recipient.

import { z } from "zod";
import { db } from "@/lib/db";
import { sendEmail, emailConfigured } from "@/lib/exercise/email";
import { getExerciseSettings } from "@/lib/exercise/settings";
import { ServiceError } from "./errors";
import { formatInZone } from "./time";
import { readPlan } from "./schemas";
import { exerciseInviteIcs } from "./invite-ics";
import { INVITE_NOTE_MAX, INVITE_RAW_MAX, inviteBody, inviteStart, inviteSubject, joinLink, parseInviteEmails, publicBaseUrl } from "./invite";

export const inviteRequestSchema = z
  .object({
    emails: z.string().max(INVITE_RAW_MAX),
    note: z.string().trim().max(INVITE_NOTE_MAX, `Keep the note to ${INVITE_NOTE_MAX} characters.`).optional(),
  })
  .strict();
export type InviteRequest = z.infer<typeof inviteRequestSchema>;

/** Invite sends per exercise per hour. */
export const INVITE_SENDS_PER_HOUR = 10;
export const inviteLimit = (exerciseId: string) => ({
  namespace: "invites:exercise",
  identifier: exerciseId,
  windowMs: 60 * 60_000,
  max: INVITE_SENDS_PER_HOUR,
});

export const EMAIL_OFF = "Email is not set up on this server.";
const OVER = new Set(["ended", "abandoned"]);
const CONCURRENCY = 4;

async function exerciseForInvite(exerciseId: string) {
  const ex = await db.exercise.findUnique({
    where: { id: exerciseId },
    select: { id: true, title: true, status: true, guestJoin: true, joinCode: true, plan: true, scenarioStartAt: true, timeboxMin: true, templateId: true },
  });
  if (!ex) throw new ServiceError(404, "Exercise not found.");
  if (OVER.has(ex.status)) throw new ServiceError(409, "The exercise is over.");
  return ex;
}

async function timezone(): Promise<string> {
  const i = await getExerciseSettings();
  return i?.timezone ?? "UTC";
}

/** Base URL for links: PUBLIC_URL, else the request origin. */
function baseUrl(fallbackOrigin: string): string {
  return publicBaseUrl() ?? fallbackOrigin;
}

/** Validate before any send. Throws ServiceError with a message for the form. */
export function checkInviteRequest(input: InviteRequest): string[] {
  const parsed = parseInviteEmails(input.emails);
  if (!parsed.ok) throw new ServiceError(400, parsed.error);
  return parsed.emails;
}

/** Send one plain-text invite per address. Returns counts only. */
export async function sendExerciseInvites(
  exerciseId: string,
  emails: string[],
  note: string | undefined,
  origin: string,
): Promise<{ sent: number; failed: number }> {
  if (!emailConfigured()) throw new ServiceError(409, EMAIL_OFF);
  const ex = await exerciseForInvite(exerciseId);
  if (!ex.guestJoin || !ex.joinCode) throw new ServiceError(409, "Turn on join by code first.");
  const tz = await timezone();
  const start = inviteStart(readPlan(ex.plan).startsAt, ex.scenarioStartAt);
  const text = {
    title: ex.title,
    startLabel: start ? formatInZone(start, tz) : null,
    joinUrl: joinLink(baseUrl(origin), ex.joinCode),
    code: ex.joinCode,
    note: note ?? null,
  };
  const subject = inviteSubject(ex.title);
  const body = inviteBody(text);

  let sent = 0;
  let failed = 0;
  const queue = [...emails];
  async function worker() {
    for (let to = queue.shift(); to !== undefined; to = queue.shift()) {
      try {
        const r = await sendEmail({ to, subject, text: body });
        if (r.sent) sent++;
        else failed++;
      } catch (err) {
        failed++;
        const code = (err as { code?: unknown; responseCode?: unknown }).responseCode ?? (err as { code?: unknown }).code ?? "error";
        console.error(`[invites] one invite was not sent (${String(code).slice(0, 40)})`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, emails.length) }, worker));
  return { sent, failed };
}

/** The template's executive brief, the pre-read. */
async function brief(templateId: string | null): Promise<string | null> {
  if (!templateId) return null;
  const t = await db.exerciseTemplate.findUnique({ where: { id: templateId }, select: { config: true } });
  const md = (t?.config as { executiveBriefMd?: unknown } | null)?.executiveBriefMd;
  return typeof md === "string" && md.trim() ? md.slice(0, 6000) : null;
}

/** Calendar file for one exercise. Needs a start time. */
export async function exerciseInviteCalendar(exerciseId: string, origin: string, now = new Date()): Promise<{ title: string; ics: string }> {
  const ex = await exerciseForInvite(exerciseId);
  const start = inviteStart(readPlan(ex.plan).startsAt, ex.scenarioStartAt, now);
  if (!start) throw new ServiceError(409, "Set a start time first.");
  const base = baseUrl(origin);
  const ics = exerciseInviteIcs({
    exerciseId: ex.id,
    title: ex.title,
    start,
    durationMin: ex.timeboxMin,
    join: ex.guestJoin && ex.joinCode ? { url: joinLink(base, ex.joinCode), code: ex.joinCode } : null,
    exerciseUrl: `${base}/play/${ex.id}`,
    briefMd: await brief(ex.templateId),
    now,
  });
  return { title: ex.title, ics };
}
