import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db } from "@/lib/db";
import { parseJsonBody } from "@/lib/http/parse-body";
import {
  checkRateLimit,
  ipFromRequest,
  peekRateLimit,
  recordRateLimitHit,
} from "@/lib/security/rate-limit";
import {
  SETUP_ADVISORY_LOCK_KEY,
  ensureSetupCode,
  hasActiveSetupCode,
  invalidateSetupCode,
  setupBootId,
  verifySetupCode,
} from "@/lib/setup/setup-code";
import { recordActivity } from "@/lib/security/activity-log";
import { recordAdminAuditLog } from "@/lib/admin-audit";
import { ensureExerciseLibrary } from "@/lib/exercise/library";

// The setup code lives on globalThis in this Node process (see setup-code.ts).
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// POST /api/public/setup — first-run setup.
// Creates the install's organization and its first administrator, in the
// browser, on a fresh database. Self-gating: refuses (410) the moment any
// user exists, so it is only ever usable once. Everyone after the first
// admin joins via an invite link (see /api/public/register).
//
// Gated by the one-time SETUP CODE printed to the server log at boot (see
// src/lib/setup/setup-code.ts): missing / wrong / no active code -> 403.
// Concurrency: the create runs under a transaction-scoped Postgres advisory
// lock with the zero-users check repeated inside it, so two concurrent setups
// (even with the right code) can never both succeed.
// ---------------------------------------------------------------------------

const SETUP_CODE_WINDOW_MS = 15 * 60 * 1000;
const SETUP_CODE_MAX_FAILURES = 10;

const setupSchema = z.object({
  orgName: z.string().trim().min(2, "Organization name must be at least 2 characters").max(80),
  name: z.string().trim().min(1, "Name is required").max(200),
  email: z.string().email("Invalid email address").max(320),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  // Optional at the schema level so a missing code is a clear 403, not a 400.
  setupCode: z.string().max(64).optional(),
});

const ALREADY_SET_UP = "This install is already set up. Sign in instead.";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || `org-${crypto.randomBytes(4).toString("hex")}`;
}

export async function GET() {
  const users = await db.user.count();
  // No server.ts boot hook (plain `next dev`)? Issue + log a code lazily.
  if (users === 0) await ensureSetupCode(async () => users);
  return NextResponse.json({ needsSetup: users === 0 });
}

export async function POST(req: Request) {
  const ip = ipFromRequest(req);
  const ipLimit = await checkRateLimit({
    // Keyed per boot: a restart resets it (see setupBootId).
    namespace: `setup:ip:${setupBootId()}`,
    identifier: ip,
    windowMs: 60 * 60 * 1000,
    max: 10,
  });
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfter) } }
    );
  }

  const parsed = await parseJsonBody(req, setupSchema);
  if (!parsed.ok) return parsed.response;

  const { orgName, name, password, setupCode } = parsed.data;
  const email = parsed.data.email.toLowerCase().trim();

  const existingUsers = await db.user.count();
  if (existingUsers > 0) {
    return NextResponse.json({ error: ALREADY_SET_UP }, { status: 410 });
  }

  // --- One-time setup code ---------------------------------------------------
  // Dedicated limiter; only FAILED attempts count, so the operator's correct
  // entry never trips it.
  const codeLimit = {
    namespace: `setup:code:ip:${setupBootId()}`,
    identifier: ip,
    windowMs: SETUP_CODE_WINDOW_MS,
    max: SETUP_CODE_MAX_FAILURES,
  };
  const codePeek = await peekRateLimit(codeLimit);
  if (!codePeek.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(codePeek.retryAfter) } }
    );
  }
  if (!hasActiveSetupCode()) {
    await recordRateLimitHit(codeLimit);
    return NextResponse.json(
      {
        error:
          "No setup code is active. Reload this page to print a new one to the server log.",
      },
      { status: 403 }
    );
  }
  if (!setupCode || !verifySetupCode(setupCode)) {
    await recordRateLimitHit(codeLimit);
    return NextResponse.json(
      {
        error: setupCode
          ? "Invalid setup code. Copy the current one from the server log."
          : "Setup code required. Find it in the server log.",
      },
      { status: 403 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const created = await db.$transaction(async (tx) => {
      // Race guard: serialize concurrent setups on one advisory lock (released
      // at commit/rollback), then re-check "zero users" under it. Without the
      // lock, two READ COMMITTED transactions could both count zero.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SETUP_ADVISORY_LOCK_KEY})`;
      const usersNow = await tx.user.count();
      if (usersNow > 0) throw new Error("setup-already-done");

      const org = await tx.organization.create({
        data: {
          name: orgName,
          slug: slugify(orgName),
        },
      });
      const admin = await tx.user.create({
        data: {
          email,
          name,
          passwordHash,
          organizationId: org.id,
          role: "administrator",
          // The person installing the software does not need to verify their
          // own email against a mail provider they may not have configured yet.
          emailVerified: new Date(),
        },
      });
      return { org, admin };
    });

    invalidateSetupCode();
    // Seed the exercise library (templates, library documents) for the new
    // organization. Best effort; it never throws and reruns on the next page.
    void ensureExerciseLibrary();
    // Audit + activity trail (both best-effort, never fail the response).
    void recordActivity({
      action: "setup.completed",
      userId: created.admin.id,
      organizationId: created.org.id,
      req,
    });
    await recordAdminAuditLog({
      actorUserId: created.admin.id,
      actorEmail: created.admin.email,
      actorName: created.admin.name,
      organizationId: created.org.id,
      action: "setup.completed",
      targetType: "organization",
      targetId: created.org.id,
      targetLabel: created.org.name,
    }).catch(() => {});
    return NextResponse.json({ success: true, email }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "setup-already-done") {
      invalidateSetupCode();
      return NextResponse.json({ error: ALREADY_SET_UP }, { status: 410 });
    }
    console.error("[setup] Error:", error);
    return NextResponse.json(
      { error: "Couldn't finish setup. Check the server log and try again." },
      { status: 500 }
    );
  }
}
