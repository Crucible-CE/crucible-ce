import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sha256Hex } from "@/lib/crypto/hash";
import {
  VERIFY_TOKEN_TTL_DAYS,
  isVerifyTokenExpired,
  isWellFormedVerifyToken,
  verifyTokenChannel,
  verifyTokenCutoff,
} from "@/lib/contacts/verify-token";

type Ctx = { params: Promise<{ token: string }> };

// GET /api/public/escalation-verify/[token]
// The link in the verification email. It must NOT change state: mail scanners
// and link previewers fetch URLs before the human does. It only redirects to
// the confirm page, which POSTs back here when the contact clicks "Confirm".
export async function GET(_req: Request, { params }: Ctx) {
  const { token } = await params;
  // Relative Location: correct behind a proxy regardless of the internal Host.
  return new Response(null, {
    status: 303,
    headers: {
      Location: `/escalation-verify/${encodeURIComponent(token ?? "")}`,
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    },
  });
}

// POST /api/public/escalation-verify/[token]
// PUBLIC (under /api/public, middleware-exempt): the contact confirms their
// details. Possession of the unguessable token is the authorization: the
// EMAILED token proves the mailbox (emailVerifiedAt), the SMS token proves the
// phone (phoneVerifiedAt; only then may pages text / call it). Each token is
// single-use (burned atomically on success) and expires VERIFY_TOKEN_TTL_DAYS
// after it was sent.
export async function POST(_req: Request, { params }: Ctx) {
  const { token } = await params;
  if (!isWellFormedVerifyToken(token)) {
    return NextResponse.json({ error: "This link isn't valid." }, { status: 400 });
  }

  const tokenHash = sha256Hex(token);
  const channel = verifyTokenChannel(token);
  const contact = await db.escalationContact.findFirst({
    where: channel === "phone" ? { phoneVerificationTokenHash: tokenHash } : { verificationTokenHash: tokenHash },
    select: { id: true, name: true, verificationSentAt: true, phoneVerificationSentAt: true },
  });
  if (!contact) {
    return NextResponse.json(
      { error: "This link isn't valid or was already used." },
      { status: 404 },
    );
  }
  if (isVerifyTokenExpired(channel === "phone" ? contact.phoneVerificationSentAt : contact.verificationSentAt)) {
    return NextResponse.json(
      {
        error: `This link expired after ${VERIFY_TOKEN_TTL_DAYS} days. Ask your organization for a new one.`,
        code: "expired",
      },
      { status: 410 },
    );
  }

  // Conditional update = single use under concurrency: only the request that
  // still sees the unburned, unexpired token flips it.
  const now = new Date();
  const cutoff = verifyTokenCutoff(now);
  const { count } =
    channel === "phone"
      ? await db.escalationContact.updateMany({
          where: { id: contact.id, phoneVerificationTokenHash: tokenHash, phoneVerificationSentAt: { gte: cutoff } },
          data: { phoneVerifiedAt: now, phoneVerificationTokenHash: null, phoneVerificationSentAt: null },
        })
      : await db.escalationContact.updateMany({
          where: { id: contact.id, verificationTokenHash: tokenHash, verificationSentAt: { gte: cutoff } },
          data: { emailVerifiedAt: now, verificationTokenHash: null, verificationSentAt: null },
        });
  if (count !== 1) {
    return NextResponse.json(
      { error: "This link isn't valid or was already used." },
      { status: 404 },
    );
  }

  return NextResponse.json({ confirmed: true, name: contact.name, channel });
}
