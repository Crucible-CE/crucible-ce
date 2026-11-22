import { NextResponse } from "next/server";
import { loadPendingLogin } from "@/lib/auth/mfa/login";
import { authenticationOptions } from "@/lib/auth/mfa/webauthn";
import { checkRateLimit, ipFromRequest } from "@/lib/security/rate-limit";

// POST /api/public/mfa/webauthn-options — a WebAuthn challenge for the sign-in
// second step, bound to the pending ticket (and deleted when used). Needs the
// pending-ticket cookie.
export async function POST(req: Request) {
  const rl = await checkRateLimit({ namespace: "mfa-webauthn-options:ip", identifier: ipFromRequest(req), windowMs: 15 * 60 * 1000, max: 60 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
  }
  const pending = await loadPendingLogin(req);
  if (!pending) {
    return NextResponse.json({ error: "Your sign-in expired. Enter your password again.", code: "mfa_expired" }, { status: 401 });
  }
  const r = await authenticationOptions(pending.user.id, "login", pending.ticket.id);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 400 });
  return NextResponse.json({ options: r.options }, { headers: { "Cache-Control": "no-store" } });
}
