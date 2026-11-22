import { NextResponse } from "next/server";
import { loadPendingLogin, pendingFactors } from "@/lib/auth/mfa/login";

// GET /api/public/mfa/pending — the sign-in page's second step: which factors
// this pending sign-in can use. Authorized by the signed pending-ticket cookie
// set when the password was accepted; no session exists yet. Answers 200 with
// { pending: false } when there is none (expired, used, or never started), so
// the page can drop back to the password step.
export async function GET(req: Request) {
  const pending = await loadPendingLogin(req);
  if (!pending) return NextResponse.json({ pending: false }, { headers: { "Cache-Control": "no-store" } });
  const factors = await pendingFactors(pending.user.id);
  return NextResponse.json(
    { pending: true, factors, expiresAt: pending.ticket.expiresAt.toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
