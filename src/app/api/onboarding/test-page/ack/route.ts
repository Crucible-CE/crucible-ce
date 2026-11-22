import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { TEST_PAGE_KEY } from "@/lib/onboarding/state";
import { ackTestPage, findTestPage } from "@/lib/onboarding/test-page-ack";

// POST /api/onboarding/test-page/ack — acknowledge your own pending test page
// in the app (the Ops Room "Needs you now" button). 404 when none is pending.
export async function POST() {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const row = await db.onboardingState.findUnique({
    where: { scope_subjectId_key: { scope: "user", subjectId: user.id, key: TEST_PAGE_KEY } },
    select: { id: true },
  });
  const rec = row ? await findTestPage(row.id) : null;
  if (!rec || rec.state.ackedAt) return NextResponse.json({ error: "No test page to acknowledge" }, { status: 404 });
  const won = await ackTestPage(rec, "app");
  if (!won) return NextResponse.json({ error: "No test page to acknowledge" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
