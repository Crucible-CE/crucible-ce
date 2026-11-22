import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseJsonBody } from "@/lib/http/parse-body";
import { resolveStatusPageToken, sendSubscribeConfirmEmail } from "@/lib/incident/status-page";
import { checkRateLimit, ipFromRequest } from "@/lib/security/rate-limit";
import { getPublicBaseUrl } from "@/lib/email/resend";
import { sha256Hex } from "@/lib/crypto/hash";

const bodySchema = z.object({ email: z.string().trim().email().max(320) });
const GENERIC = { ok: true, message: "Check your inbox to confirm." };
const RESEND_AFTER_MS = 10 * 60_000;

// POST /api/public/status/[token]/subscribe: double opt-in. Always the same
// answer, so it never reveals whether an address is already subscribed.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const rl = await checkRateLimit({ namespace: "status-page:subscribe", identifier: ipFromRequest(req), windowMs: 60_000, max: 5 });
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });

  const { token } = await params;
  const page = await resolveStatusPageToken(token);
  if (!page) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = await parseJsonBody(req, bodySchema);
  if (!parsed.ok) return parsed.response;
  const email = parsed.data.email.toLowerCase();

  const perEmail = await checkRateLimit({ namespace: "status-page:subscribe-email", identifier: sha256Hex(email).slice(0, 32), windowMs: 60 * 60_000, max: 3 });
  if (!perEmail.allowed) return NextResponse.json(GENERIC);

  const existing = await db.statusPageSubscriber.findUnique({
    where: { statusPageId_email: { statusPageId: page.id, email } },
    select: { id: true, confirmedAt: true, unsubscribedAt: true, confirmSentAt: true },
  });
  // Already confirmed and subscribed: nothing to send.
  if (existing?.confirmedAt && !existing.unsubscribedAt) return NextResponse.json(GENERIC);
  if (existing?.confirmSentAt && !existing.unsubscribedAt && Date.now() - existing.confirmSentAt.getTime() < RESEND_AFTER_MS) {
    return NextResponse.json(GENERIC);
  }

  const confirmToken = randomBytes(32).toString("hex");
  const now = new Date();
  try {
    await db.statusPageSubscriber.upsert({
      where: { statusPageId_email: { statusPageId: page.id, email } },
      // Coming back after unsubscribing starts the double opt-in again.
      update: { confirmTokenHash: sha256Hex(confirmToken), confirmSentAt: now, confirmedAt: null, unsubscribedAt: null },
      create: { organizationId: page.organizationId, statusPageId: page.id, email, confirmTokenHash: sha256Hex(confirmToken), confirmSentAt: now },
    });
  } catch {
    return NextResponse.json(GENERIC);
  }

  const base = getPublicBaseUrl().replace(/\/+$/, "");
  void sendSubscribeConfirmEmail({
    to: email,
    orgName: page.orgName,
    title: page.title,
    confirmUrl: `${base}/api/public/status-confirm/${confirmToken}`,
    pageUrl: `${base}/status/${token}`,
  });
  return NextResponse.json(GENERIC);
}
