import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { sendTestPage } from "@/lib/onboarding/test-page";

// POST /api/onboarding/test-page — send yourself a test page (onboarding, Your
// setup): email through the active transport plus SMS to a verified phone,
// each with a signed ack link to the normal page-ack landing page. Any member,
// readers included; tightly rate limited (it can reach SMS).
export async function POST() {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = await checkRateLimit({ namespace: "onboarding-test-page", identifier: user.id, windowMs: 10 * 60_000, max: 5 });
  if (!rl.allowed) {
    return NextResponse.json({ error: `Too many test pages. Try again in ${rl.retryAfter}s.` }, { status: 429 });
  }

  const testPage = await sendTestPage({ id: user.id, organizationId: user.organizationId });
  return NextResponse.json({ testPage });
}
