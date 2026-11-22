import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db } from "@/lib/db";
import { sendWelcomeEmail } from "@/lib/email/send-welcome";
import { validateBotCheck } from "@/lib/security/bot-check";
import {
  verifyOrgInviteToken,
  ORG_INVITE_ALLOWED_ROLES,
  ORG_INVITE_DEFAULT_ROLE,
} from "@/lib/org-invite/tokens";
import { checkRateLimit, ipFromRequest } from "@/lib/security/rate-limit";
import { hashToken } from "@/lib/auth/verification-token";
import { parseJsonBody } from "@/lib/http/parse-body";
import { LIMITS } from "@/lib/http/limits";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const registerSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  email: z.string().email("Invalid email address").max(320),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  orgInviteToken: z.string().max(LIMITS.URL).optional(),
  // Honeypot bot check — validated by validateBotCheck after schema parse.
  honeypot: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// POST /api/public/register
// ---------------------------------------------------------------------------
// CE registration is invite-only: members join the install's organization via
// an admin-minted invite link. The organization itself (and its first admin)
// is created once through the /setup first-run wizard, never here.
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const ip = ipFromRequest(req);

  // 5 registration attempts per IP per hour (Redis-backed, multi-replica safe).
  const ipLimit = await checkRateLimit({
    namespace: "register:ip",
    identifier: ip,
    windowMs: 60 * 60 * 1000,
    max: 5,
  });
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfter) } }
    );
  }

  const parsed = await parseJsonBody(req, registerSchema);
  if (!parsed.ok) return parsed.response;

  const { name, password, orgInviteToken } = parsed.data;
  const email = parsed.data.email.toLowerCase().trim();

  // Registration is gated: an invite joins the existing org. A token-less
  // request is an anonymous self-signup attempt; reject it.
  if (!orgInviteToken) {
    return NextResponse.json(
      { error: "You need an invite from your admin." },
      { status: 403 }
    );
  }

  // Bot check (honeypot).
  const botCheck = validateBotCheck({ honeypot: parsed.data.honeypot });
  if (!botCheck.ok) {
    return NextResponse.json({ error: botCheck.reason }, { status: 400 });
  }

  // Admin-generated org invite token (stateful, tracked in OrgInvite).
  let invite: { orgId: string; orgName: string; role: string } | null = null;
  let orgInviteRow: { id: string; skipEmailVerification: boolean } | null = null;
  // Set by the in-transaction claim when the invite was consumed concurrently.
  class InviteAlreadyUsed extends Error {}
  {
    const result = verifyOrgInviteToken(orgInviteToken);
    if (!result.valid) {
      return NextResponse.json(
        { error: result.error ?? "Invalid or expired invite link." },
        { status: 400 }
      );
    }

    const row = await db.orgInvite.findUnique({
      where: { tokenHash: result.idHash },
      select: {
        id: true,
        organizationId: true,
        role: true,
        usedAt: true,
        revokedAt: true,
        expiresAt: true,
        skipEmailVerification: true,
        inviteeEmail: true,
        organization: { select: { id: true, name: true } },
      },
    });
    if (!row) {
      return NextResponse.json(
        { error: "Invite not found." },
        { status: 400 }
      );
    }
    if (row.revokedAt) {
      return NextResponse.json(
        { error: "This invite was revoked." },
        { status: 400 }
      );
    }
    if (row.usedAt) {
      return NextResponse.json(
        { error: "This invite has already been used." },
        { status: 400 }
      );
    }
    if (row.expiresAt.getTime() < Date.now()) {
      return NextResponse.json(
        { error: "This invite has expired." },
        { status: 400 }
      );
    }

    // An invite minted for a specific address only works for that address.
    if (row.inviteeEmail && row.inviteeEmail.trim().toLowerCase() !== email) {
      return NextResponse.json(
        { error: "This invite is for a different email address." },
        { status: 403 }
      );
    }
    // Defense in depth: never mint a role that doesn't exist.
    if (row.role && !(ORG_INVITE_ALLOWED_ROLES as readonly string[]).includes(row.role)) {
      return NextResponse.json({ error: "This invite is no longer valid." }, { status: 400 });
    }

    invite = {
      orgId: row.organization.id,
      orgName: row.organization.name,
      role: row.role || ORG_INVITE_DEFAULT_ROLE,
    };
    orgInviteRow = {
      id: row.id,
      skipEmailVerification: row.skipEmailVerification,
    };
  }

  // Check email uniqueness
  const existingUser = await db.user.findUnique({ where: { email } });
  if (existingUser) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409 }
    );
  }


  const passwordHash = await bcrypt.hash(password, 12);

  try {
    // Create verification token for email verification. Plaintext is emailed
    // to the user; only the SHA-256 digest is stored in the DB.
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationTokenHash = hashToken(verificationToken);

    // Admin-minted org invites can carry a per-invite verification bypass:
    // the user is created pre-verified and no token row is issued.
    const skipVerification = orgInviteRow?.skipEmailVerification === true;

    await db.$transaction(async (tx) => {
      // Atomic single-use claim FIRST: of two concurrent registrations with
      // the same invite, exactly one flips usedAt; the other aborts and rolls
      // back (no second account).
      if (orgInviteRow) {
        const claim = await tx.orgInvite.updateMany({
          where: { id: orgInviteRow.id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
          data: { usedAt: new Date() },
        });
        if (claim.count !== 1) throw new InviteAlreadyUsed();
      }
      const created = await tx.user.create({
        data: {
          email,
          name,
          passwordHash,
          organizationId: invite!.orgId,
          role: invite!.role,
          emailVerified: skipVerification ? new Date() : null,
        },
      });
      if (!skipVerification) {
        await tx.verificationToken.create({
          data: {
            identifier: email,
            token: verificationTokenHash,
            expires: new Date(Date.now() + 24 * 60 * 60_000), // 24 hours
          },
        });
      }

      if (orgInviteRow) {
        await tx.orgInvite.update({
          where: { id: orgInviteRow.id },
          data: { usedByUserId: created.id },
        });
      }
    });

    // Fire-and-forget: send welcome email. Failure is non-blocking for the
    // user (they still get the verification token in DB), but we surface it
    // in logs so a misconfigured mail provider is diagnosable.
    sendWelcomeEmail(
      email,
      name,
      invite!.orgName,
      skipVerification ? undefined : verificationToken
    ).catch((err) => {
      console.error("[register] welcome email failed:", {
        email,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return NextResponse.json(
      { success: true, email, emailVerificationRequired: !skipVerification },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof InviteAlreadyUsed) {
      return NextResponse.json({ error: "This invite has already been used." }, { status: 400 });
    }
    const code = (error as { code?: string })?.code;
    if (code === "P2002") {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    }
    console.error("[register] Error:", error);
    return NextResponse.json(
      { error: "Couldn't create your account. Try again." },
      { status: 500 }
    );
  }
}
