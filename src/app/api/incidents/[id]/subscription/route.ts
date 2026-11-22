import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { parseJsonBody } from "@/lib/http/parse-body";

// Per-user follow / mute of an incident.
//   watch — receive collaboration-level activity even if you're not on the roster
//   mute  — silence everything but critical pages
//   none  — default (roster rules apply)

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  // Access check first: never reveal (via 200 vs 404) that a locked or
  // deleted incident exists.
  const incident = await db.incident.findFirst({ where: { id, ...accessibleIncidentsWhere(session.user) }, select: { id: true } });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const sub = await db.incidentSubscription.findUnique({ where: { userId_incidentId: { userId: session.user.id, incidentId: id } } });
  return NextResponse.json({ mode: sub?.mode ?? "none" }, { headers: { "Cache-Control": "no-store" } });
}

const putSchema = z.object({ mode: z.enum(["watch", "mute", "none"]) });

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const incident = await db.incident.findFirst({ where: { id, ...accessibleIncidentsWhere(session.user) }, select: { id: true } });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = await parseJsonBody(req, putSchema);
  if (!parsed.ok) return parsed.response;

  if (parsed.data.mode === "none") {
    await db.incidentSubscription.deleteMany({ where: { userId: session.user.id, incidentId: id } });
  } else {
    await db.incidentSubscription.upsert({
      where: { userId_incidentId: { userId: session.user.id, incidentId: id } },
      create: { userId: session.user.id, incidentId: id, mode: parsed.data.mode },
      update: { mode: parsed.data.mode },
    });
  }
  return NextResponse.json({ mode: parsed.data.mode });
}
