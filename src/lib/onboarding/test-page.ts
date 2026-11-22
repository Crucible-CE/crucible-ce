// "Acknowledge a test page" (onboarding, Your setup): a page to yourself that
// behaves like a real one. It goes out through the existing test-send path
// (sendTestDelivery on the active email transport) and, when the member has a
// dialable phone, a metered SMS (same toll-fraud limits as every other SMS).
// Both carry a signed ack link to the normal /api/public/page-ack/<token>
// landing page; the Ops Room shows it under "Needs you now" with an inline
// Acknowledge. No incident is created and nothing escalates.
//
// The OnboardingState row id is the "page id" inside the token and the send
// counter (seq) is its "level", so a link from an earlier send dies when a new
// one goes out, exactly like a page that escalated.

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { ackUrlFor, resolvePageRecipient, sendTestDelivery } from "@/lib/delivery/engine";
import { sendMeteredSms } from "@/lib/delivery/metered";
import { activeEmailTransport } from "@/lib/email/transport";
import { TEST_PAGE_KEY, readTestPage, type TestPageState } from "./state";

export const TEST_PAGE_TITLE = "Test page from Crucible";

function toJson(s: Omit<TestPageState, "id">): Prisma.InputJsonValue {
  return s as unknown as Prisma.InputJsonValue;
}

export async function sendTestPage(user: { id: string; organizationId: string }, now: Date = new Date()): Promise<TestPageState> {
  const existing = await db.onboardingState.findUnique({
    where: { scope_subjectId_key: { scope: "user", subjectId: user.id, key: TEST_PAGE_KEY } },
    select: { id: true, value: true },
  });
  const prev = existing ? readTestPage(existing.id, existing.value) : null;
  const seq = prev ? (prev.seq + 1) % 1000 : 0;
  const base: Omit<TestPageState, "id"> = {
    seq,
    sentAt: now.toISOString(),
    deliveredAt: null,
    channels: [],
    ackedAt: null,
    ackedVia: null,
    everAckedAt: prev?.everAckedAt ?? null,
  };
  // Persist BEFORE sending, so a fast ack from the email never races the write.
  const row = await db.onboardingState.upsert({
    where: { scope_subjectId_key: { scope: "user", subjectId: user.id, key: TEST_PAGE_KEY } },
    create: { scope: "user", subjectId: user.id, key: TEST_PAGE_KEY, value: toJson(base) },
    update: { value: toJson(base) },
    select: { id: true },
  });

  const ackUrl = ackUrlFor(row.id, seq, now);
  const text =
    "This is a test page from Crucible CE. Acknowledge it to finish the test.";
  const recipient = await resolvePageRecipient({ organizationId: user.organizationId, targetUserId: user.id, targetContactId: null });

  const channels: TestPageState["channels"] = [];
  const email = activeEmailTransport();
  if (email && recipient?.email) {
    const r = await sendTestDelivery(email, recipient, { title: TEST_PAGE_TITLE, text, ackUrl });
    channels.push({ provider: email, channel: "email", status: r.status, error: r.error ?? null });
  } else {
    channels.push({ provider: email ?? "email", channel: "email", status: "skipped", error: email ? "No email address on file" : "not configured" });
  }
  if (recipient?.phone) {
    const r = await sendMeteredSms({
      organizationId: user.organizationId,
      to: recipient.phone,
      body: `Crucible: ${TEST_PAGE_TITLE}. Acknowledge: ${ackUrl}`,
      purpose: "test_page",
      now,
    });
    channels.push({ provider: "twilio-sms", channel: "sms", status: r.ok ? "sent" : r.skipped ? "skipped" : "failed", error: r.ok ? null : r.detail ?? null });
  }

  // Merge onto the CURRENT row: an ack may already have landed while sending.
  const cur = await db.onboardingState.findUnique({ where: { id: row.id }, select: { value: true } });
  const curState = cur ? readTestPage(row.id, cur.value) : null;
  const acked = curState && curState.seq === seq ? curState : null;
  const final: Omit<TestPageState, "id"> = {
    ...base,
    ackedAt: acked?.ackedAt ?? null,
    ackedVia: acked?.ackedVia ?? null,
    everAckedAt: acked?.everAckedAt ?? base.everAckedAt,
    channels,
    deliveredAt: channels.some((c) => c.status === "sent") ? new Date().toISOString() : null,
  };
  await db.onboardingState.update({ where: { id: row.id }, data: { value: toJson(final) } });
  return { id: row.id, ...final };
}
