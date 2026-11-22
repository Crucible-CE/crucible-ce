// POST   /api/cloud-notes   {note}  hide one Cloud note for the signed-in user
// DELETE /api/cloud-notes           show every dismissed note again
// Facilitators and administrators only. Nothing else is recorded.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { parseJsonBody } from "@/lib/http/parse-body";
import { CLOUD_NOTE_KEYS, roleSeesCloudNotes } from "@/lib/cloud/notes";
import { dismissCloudNote, resetCloudNotes } from "@/lib/cloud/notes-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ note: z.enum(CLOUD_NOTE_KEYS as [string, ...string[]]) });

type Caller = { ok: true; userId: string } | { ok: false; response: Response };

async function caller(): Promise<Caller> {
  const session = await auth();
  const u = session?.user;
  if (!u?.id || u.mfaEnrollRequired) return { ok: false, response: NextResponse.json({ error: "Sign in to continue." }, { status: 401 }) };
  if (!roleSeesCloudNotes(u.role)) return { ok: false, response: NextResponse.json({ error: "You do not have access to this." }, { status: 403 }) };
  return { ok: true, userId: u.id };
}

export async function POST(req: Request): Promise<Response> {
  const c = await caller();
  if (!c.ok) return c.response;
  const parsed = await parseJsonBody(req, bodySchema);
  if (!parsed.ok) return parsed.response;
  await dismissCloudNote(c.userId, parsed.data.note as (typeof CLOUD_NOTE_KEYS)[number]);
  return NextResponse.json({ ok: true });
}

export async function DELETE(): Promise<Response> {
  const c = await caller();
  if (!c.ok) return c.response;
  const count = await resetCloudNotes(c.userId);
  return NextResponse.json({ ok: true, count });
}
