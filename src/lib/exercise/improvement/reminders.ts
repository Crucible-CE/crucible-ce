// Overdue and due-soon reminders for action item owners. A daily cron emails
// pocEmail for open items due within 7 days or already overdue, at most once
// a week per item (lastRemindedAt). Does nothing when mail is not configured.
//
// pocEmail is free text anyone with plan access can set, so a reminder goes
// only to an address of an active user account, or to a domain listed in
// ExerciseSettings.policy.reminderDomains. Anything else is skipped and logged. The
// subject is fixed; the body is plain text.
//
// Registered by src/improvement/cron.ts, imported from src/runtime/jobs/handler-modules.ts at boot.

import { db } from "@/lib/db";
import { getExerciseSettings } from "@/lib/exercise/settings";
import { registerCron } from "@/lib/exercise/runtime/cron";
import { emailConfigured, sendEmail } from "@/lib/exercise/email";

const DAY_MS = 24 * 60 * 60 * 1000;
export const REMIND_WINDOW_DAYS = 7;
export const REMIND_EVERY_DAYS = 7;

/** User text for a plain text body: no control characters, one line, capped. */
function bodyText(v: string, max = 500): string {
  const flat = v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
}

export function reminderText(item: { afi: string; correctiveAction: string; dueDate: Date; overdue: boolean }, publicUrl?: string): { subject: string; text: string } {
  const due = item.dueDate.toISOString().slice(0, 10);
  // Fixed subject: no user text in a header.
  const subject = item.overdue ? `Work item overdue since ${due}` : `Work item due ${due}`;
  const lines = [
    item.overdue ? `This work item was due ${due}.` : `This work item is due ${due}.`,
    "",
    `Corrective action: ${bodyText(item.correctiveAction)}`,
    `Area for improvement: ${bodyText(item.afi)}`,
  ];
  if (publicUrl) lines.push("", `Update it at ${publicUrl.replace(/\/+$/, "")}/action-items`);
  return { subject, text: lines.join("\n") };
}

/** Lowercase domains from ExerciseSettings.policy.reminderDomains, if set. */
export function reminderDomains(policy: unknown): Set<string> {
  const raw = policy && typeof policy === "object" ? (policy as { reminderDomains?: unknown }).reminderDomains : undefined;
  const list = Array.isArray(raw) ? raw : [];
  return new Set(
    list
      .filter((d): d is string => typeof d === "string")
      .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
      .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)),
  );
}

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1).trim().toLowerCase();
}

/** Send due reminders. Returns how many emails went out. */
export async function sendDueReminders(now = new Date()): Promise<number> {
  if (!emailConfigured()) return 0;
  const items = await db.actionItem.findMany({
    where: {
      status: { in: ["open", "in_progress"] },
      pocEmail: { not: null },
      dueDate: { lte: new Date(now.getTime() + REMIND_WINDOW_DAYS * DAY_MS) },
      OR: [{ lastRemindedAt: null }, { lastRemindedAt: { lt: new Date(now.getTime() - REMIND_EVERY_DAYS * DAY_MS) } }],
    },
    select: { id: true, afi: true, correctiveAction: true, dueDate: true, pocEmail: true },
    take: 500,
  });
  const emails = [...new Set(items.map((i) => i.pocEmail?.trim().toLowerCase()).filter((e): e is string => Boolean(e)))];
  const [users, instance] = await Promise.all([
    emails.length ? db.user.findMany({ where: { isActive: true, email: { in: emails, mode: "insensitive" } }, select: { email: true } }) : [],
    getExerciseSettings(),
  ]);
  const known = new Set(users.map((u) => u.email.toLowerCase()));
  const domains = reminderDomains(instance?.policy);
  let sent = 0;
  for (const item of items) {
    if (!item.pocEmail || !item.dueDate) continue;
    const to = item.pocEmail.trim().toLowerCase();
    if (!known.has(to) && !domains.has(domainOf(to))) {
      console.warn(`[reminders] skipped work item ${item.id}: the owner email is not an active user or an allowed domain`);
      continue;
    }
    const msg = reminderText({ ...item, dueDate: item.dueDate, overdue: item.dueDate.getTime() < now.getTime() }, process.env.PUBLIC_URL);
    try {
      const r = await sendEmail({ to, ...msg });
      if (!r.sent) continue;
      sent++;
      await db.actionItem.update({ where: { id: item.id }, data: { lastRemindedAt: now } });
    } catch (err) {
      console.error(`[reminders] could not email work item ${item.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return sent;
}

const g = globalThis as typeof globalThis & { __ceReminderCron?: boolean };

export function registerReminderCron(): void {
  if (g.__ceReminderCron) return;
  g.__ceReminderCron = true;
  registerCron("improvement:reminders", "0 13 * * *", async () => {
    const n = await sendDueReminders();
    if (n > 0) console.log(`[cron] sent ${n} work item reminder(s)`);
  });
}
