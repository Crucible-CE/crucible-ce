// Archive a template. Archived templates stay readable but leave the picker.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/exercise/audit";
import { NOT_FOUND, requireTemplateManager } from "../../_lib/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requireTemplateManager();
  if (!a.ok) return a.response;
  const { id } = await ctx.params;
  const t = await db.exerciseTemplate.findUnique({ where: { id }, select: { status: true } });
  if (!t) return NextResponse.json(NOT_FOUND, { status: 404 });
  await db.exerciseTemplate.update({ where: { id }, data: { status: "archived" } });
  audit({ actorUserId: a.user.id, action: "template.archived", targetType: "ExerciseTemplate", targetId: id, req });
  return NextResponse.json({ ok: true });
}
