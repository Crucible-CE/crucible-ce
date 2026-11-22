// =============================================================================
// Crucible CE - Ack-Timeout Paging Escalation Engine
// =============================================================================
// When a responder is paged and does not acknowledge by the ack deadline, the
// page escalates up the incident command roster to the next assigned role.
// Levels map onto ESCALATION_ORDER: level 0 was the original page; level N
// pages the role at ESCALATION_ORDER[N-1]. When the roster is exhausted with
// no further assigned role, the page is marked "expired".
//
// Closed incidents never page: the engine filters them at read time, guards
// every write on the incident still being open, and sweeps any page left open
// on a closed incident to "cancelled". Closing an incident should also call
// cancelOpenPagesForIncident() in the same transaction.
//
// Every escalation is delivered out-of-band (src/lib/delivery) exactly like a
// fresh page; the in-app notification stays.
// =============================================================================

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { claimOne } from "@/lib/db/atomic-claim";
import { createNotification } from "@/lib/notifications";
import { appendLedger } from "@/lib/ledger/append";
import { deliverPage, sendAckNotice } from "@/lib/delivery/engine";
import { isRedactedTarget, redactedInAppPage } from "@/lib/delivery/redaction";
import { NOT_DELETED, liveIncidentWhere } from "@/lib/incident/live";

/** Fixed escalation chain, walked by escalationLevel. */
export const ESCALATION_ORDER = ["tech_lead", "incident_commander", "exec_sponsor"] as const;

/** Minutes a re-paged target has to acknowledge before escalating again. */
const ACK_WINDOW_MINUTES = 10;

/**
 * The only terminal incident status (src/lib/incident/status.ts); a
 * soft-deleted incident never pages or escalates either.
 */
// Training incidents never page (lib/incident/training); the engine skips them too.
const OPEN_INCIDENT: Prisma.IncidentWhereInput = liveIncidentWhere({ status: { not: "closed" }, isTraining: false });

// ---------------------------------------------------------------------------
// Pure helpers (no DB) — unit tested in engine.test.ts
// ---------------------------------------------------------------------------

/** A page is overdue iff it is still "sent" and its deadline has passed. */
export function shouldEscalate(
  page: { status: string; ackDeadlineAt: Date | null },
  now: Date
): boolean {
  return page.status === "sent" && page.ackDeadlineAt != null && page.ackDeadlineAt <= now;
}

/**
 * Role to page at the NEXT level. `level` is the current escalationLevel, so the
 * next role is ESCALATION_ORDER[level]. Returns null once the chain is exhausted.
 */
export function nextEscalationRole(level: number): string | null {
  return ESCALATION_ORDER[level] ?? null;
}

// ---------------------------------------------------------------------------
// cancelOpenPagesForIncident
// ---------------------------------------------------------------------------

/**
 * Cancel every open page of an incident (status "sent" -> "cancelled") and
 * stop their pending delivery retries. Call it from every path that CLOSES an
 * incident, inside the same transaction when there is one. Returns the number
 * of pages cancelled. Idempotent.
 */
export async function cancelOpenPagesForIncident(
  incidentId: string,
  tx?: Prisma.TransactionClient,
  reason: string = "incident_closed",
): Promise<number> {
  // The cancel and its page_cancelled ledger entry commit together.
  if (!tx) return db.$transaction((t) => cancelOpenPagesForIncident(incidentId, t, reason));
  const open = await tx.incidentPage.findMany({
    where: { incidentId, status: "sent" },
    select: { id: true, organizationId: true },
  });
  const now = new Date();
  const res = await tx.incidentPage.updateMany({
    where: { incidentId, status: "sent" },
    data: { status: "cancelled", cancelledAt: now, ackDeadlineAt: null },
  });
  await tx.pageDelivery.updateMany({
    where: { incidentId, nextRetryAt: { not: null } },
    data: { nextRetryAt: null },
  });
  if (res.count > 0 && open.length > 0) {
    await appendLedger(tx, {
      incidentId,
      organizationId: open[0].organizationId,
      eventType: "page_cancelled",
      actorUserId: null,
      actorLabel: "escalation",
      payload: { reason, count: res.count, pageIds: open.map((p) => p.id) },
    });
  }
  return res.count;
}

// ---------------------------------------------------------------------------
// escalateOverduePages
// ---------------------------------------------------------------------------

/**
 * Find every overdue page and escalate (or expire) it. Each page is processed
 * independently — a failure on one is logged and never aborts the batch.
 */
export async function escalateOverduePages(
  now: Date = new Date()
): Promise<{ escalated: number; expired: number; cancelled: number }> {
  // Self-heal: a page still open on a closed incident (closed by a path that
  // didn't cancel its pages) is cancelled, never escalated.
  const swept = await db.incidentPage.updateMany({
    where: { status: "sent", incident: { status: "closed" } },
    data: { status: "cancelled", cancelledAt: now, ackDeadlineAt: null },
  });
  const cancelled = swept?.count ?? 0;

  const candidates = await db.incidentPage.findMany({
    where: { status: "sent", ackDeadlineAt: { lte: now }, incident: OPEN_INCIDENT },
  });

  let escalated = 0;
  let expired = 0;

  for (const page of candidates) {
    try {
      // Walk forward from the current level until we find a role that has a
      // user or an external escalation contact assigned, or the chain ends.
      let level = page.escalationLevel;
      let target: { userId: string | null; contactId: string | null } | null = null;

      while (true) {
        const nextRole = nextEscalationRole(level);
        if (nextRole === null) break; // chain exhausted

        const assignment = await db.incidentRoleAssignment.findFirst({
          // Defense-in-depth: keep the escalation target inside the page's org.
          where: {
            incidentId: page.incidentId,
            organizationId: page.organizationId,
            role: nextRole,
            OR: [{ userId: { not: null } }, { escalationContactId: { not: null } }],
          },
          select: { userId: true, escalationContactId: true },
        });

        // Advancing to this role bumps the level by one.
        level += 1;

        if (assignment?.userId) {
          target = { userId: assignment.userId, contactId: null };
          break;
        }
        if (assignment?.escalationContactId) {
          target = { userId: null, contactId: assignment.escalationContactId };
          break;
        }
        // Nobody holds this role — keep walking the chain.
      }

      if (target === null) {
        // No assignable role left — expire the page. Guarded so a page that
        // was acked (or re-paged elsewhere, or cancelled) since our read isn't
        // clobbered.
        const won = await claimOne(
          db.incidentPage.updateMany({
            where: { id: page.id, status: "sent", escalationLevel: page.escalationLevel },
            data: { status: "expired" },
          }),
        );
        if (won) expired += 1;
        continue;
      }

      const targetLabel = await labelFor(page.organizationId, target);

      // Re-page the next role: point the page at the NEW target (so their ack
      // matches and stops escalation), bump to the producing level, and give it
      // a fresh ack window, staying in "sent". Guarded on the exact row state we
      // read AND on the incident still being open — if the responder acked,
      // another worker escalated, or the incident closed between our findMany
      // and here, we skip: no clobber, no spurious page.
      const won = await claimOne(
        db.incidentPage.updateMany({
          where: {
            id: page.id,
            status: "sent",
            escalationLevel: page.escalationLevel,
            ackDeadlineAt: page.ackDeadlineAt,
            incident: OPEN_INCIDENT,
          },
          data: {
            targetUserId: target.userId,
            targetContactId: target.contactId,
            targetLabel,
            escalationLevel: level,
            ackDeadlineAt: new Date(now.getTime() + ACK_WINDOW_MINUTES * 60_000),
            status: "sent",
          },
        }),
      );
      if (!won) continue;

      if (target.userId) {
        // Never skipped for a LOCKED incident the new target can't see: the
        // escalation still pages them, REDACTED (no title / note / deep link).
        const redacted = await isRedactedTarget({
          organizationId: page.organizationId,
          incidentId: page.incidentId,
          targetUserId: target.userId,
          targetContactId: null,
        }).catch(() => true); // fail closed: redacted, but still paged
        if (redacted) {
          const r = redactedInAppPage(page.id, level, await severityOf(page.incidentId), "escalation");
          await createNotification(target.userId, "incident_page", r.title, r.body, r.metadata, r.link);
        } else {
          await createNotification(
            target.userId,
            "incident_page",
            "Escalated page",
            page.message ?? "An unacknowledged page was escalated to you.",
            { incidentId: page.incidentId, pageId: page.id },
            `/incidents/${page.incidentId}`
          );
        }
      }

      const escalatedTo = target.userId ?? target.contactId;
      const targetKind = target.userId ? "user" : "contact";
      await db.$transaction(async (tx) => {
        await appendLedger(tx, {
          incidentId: page.incidentId,
          organizationId: page.organizationId,
          eventType: "page_sent",
          actorUserId: null,
          actorLabel: "escalation",
          payload: { pageId: page.id, escalatedTo, targetKind, level },
        });
      });

      // Out-of-band fan-out for the new target (recorded per channel).
      await deliverPage(page.id, { kind: "escalation", now }).catch((err) => {
        console.error(`[escalation] out-of-band delivery failed for page ${page.id}:`, err);
      });

      escalated += 1;
    } catch (err) {
      // Never let one page's failure abort the batch.
      console.error(`[escalation] failed to process page ${page.id}:`, err);
    }
  }

  return { escalated, expired, cancelled };
}

async function severityOf(incidentId: string): Promise<string> {
  try {
    const inc = await db.incident.findUnique({ where: { id: incidentId, ...NOT_DELETED }, select: { severity: true } });
    return inc?.severity ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function labelFor(
  organizationId: string,
  target: { userId: string | null; contactId: string | null },
): Promise<string | null> {
  if (target.userId) {
    const u = await db.user.findFirst({ where: { id: target.userId, organizationId }, select: { name: true, email: true } });
    return u?.name ?? u?.email ?? null;
  }
  if (target.contactId) {
    const c = await db.escalationContact.findFirst({ where: { id: target.contactId, organizationId }, select: { name: true } });
    return c?.name ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// acknowledgePage
// ---------------------------------------------------------------------------

export type AckVia = "app" | "link" | "sms" | "voice";

/**
 * Acknowledge an open page. Guarded transition `sent -> acked` (optionally
 * pinned to an escalation `level`, which is what makes out-of-band tokens
 * single-use), refused when the incident is closed. Returns false when there
 * was nothing to ack (already acked, escalated past `level`, cancelled,
 * expired, or missing). Records a `page_acked` ledger entry and sends a
 * best-effort ack notice to webhook/plugin providers.
 */
export async function acknowledgePage(
  pageId: string,
  by: { userId?: string | null; via: AckVia; level?: number; actorLabel?: string | null },
): Promise<boolean> {
  // Pre-read only for the ledger fields; the transition itself is guarded so a
  // double-tap (or ack racing the escalation cron) records exactly one ack.
  const page = await db.incidentPage.findUnique({ where: { id: pageId } });
  if (!page || page.status !== "sent") return false;

  const now = new Date();
  const userId = by.userId ?? null;
  const won = await claimOne(
    db.incidentPage.updateMany({
      where: {
        id: pageId,
        status: "sent",
        ...(by.level !== undefined ? { escalationLevel: by.level } : {}),
        incident: OPEN_INCIDENT,
      },
      data: { status: "acked", acknowledgedAt: now, acknowledgedById: userId, acknowledgedVia: by.via, ackDeadlineAt: null },
    }),
  );
  if (!won) return false;

  await db.$transaction(async (tx) => {
    await appendLedger(tx, {
      incidentId: page.incidentId,
      organizationId: page.organizationId,
      eventType: "page_acked",
      actorUserId: userId,
      actorLabel: by.actorLabel ?? page.targetLabel ?? null,
      payload: {
        pageId: page.id,
        acknowledgedById: userId,
        acknowledgedContactId: userId ? null : page.targetContactId,
        via: by.via,
        level: page.escalationLevel,
      },
    });
  });

  void sendAckNotice(page.id, by.via, now);
  return true;
}
