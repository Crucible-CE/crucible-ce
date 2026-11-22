import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { findAccessibleIncident } from "@/lib/incident/access";
import { parseJsonBody } from "@/lib/http/parse-body";
import { assertIncidentWritable } from "@/lib/incident/lock";

interface RouteContext {
  params: Promise<{ id: string; postId: string }>;
}

const patchSchema = z.object({
  pinned: z.boolean().optional(),
  title: z.string().min(1).max(300).optional(),
  body: z.string().max(5000).optional(),
});

// PATCH /api/incidents/[id]/intel/[postId] — pin/unpin or edit a board item.
export async function PATCH(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id, postId } = await context.params;
  if (!(await findAccessibleIncident(session.user, id, { id: true }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;
  const post = await db.incidentIntelPost.findFirst({ where: { id: postId, incidentId: id }, select: { id: true } });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = await parseJsonBody(req, patchSchema);
  if (!parsed.ok) return parsed.response;

  const updated = await db.incidentIntelPost.update({
    where: { id: postId },
    data: {
      ...(parsed.data.pinned !== undefined ? { pinned: parsed.data.pinned } : {}),
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.body !== undefined ? { body: parsed.data.body || null } : {}),
    },
  });
  return NextResponse.json(updated);
}

// DELETE /api/incidents/[id]/intel/[postId] — remove a board item.
export async function DELETE(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id, postId } = await context.params;
  if (!(await findAccessibleIncident(session.user, id, { id: true }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;
  const post = await db.incidentIntelPost.findFirst({ where: { id: postId, incidentId: id }, select: { id: true } });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.incidentIntelPost.delete({ where: { id: postId } });
  return NextResponse.json({ ok: true });
}
