import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { findAccessibleIncident } from "@/lib/incident/access";
import { parseJsonBody } from "@/lib/http/parse-body";
import { assertIncidentWritable } from "@/lib/incident/lock";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const TAGS = ["osint", "ioc", "reference", "observation", "media"] as const;

// GET /api/incidents/[id]/intel — the persistent intel/notes board (#3),
// pinned items first then newest. Distinct from ephemeral chat.
export async function GET(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await context.params;
  const incident = await findAccessibleIncident(session.user, id, { id: true });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const posts = await db.incidentIntelPost.findMany({
    where: { incidentId: id },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      title: true,
      body: true,
      url: true,
      tag: true,
      pinned: true,
      authorName: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ posts }, { headers: { "Cache-Control": "no-store" } });
}

const postSchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().max(5000).optional(),
  url: z.string().url().max(1000).optional().or(z.literal("")),
  tag: z.enum(TAGS).optional(),
});

// POST /api/incidents/[id]/intel — add a board item.
export async function POST(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await context.params;
  const orgId = session.user.organizationId;
  const incident = await findAccessibleIncident(session.user, id, { id: true });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;

  const parsed = await parseJsonBody(req, postSchema);
  if (!parsed.ok) return parsed.response;

  const post = await db.incidentIntelPost.create({
    data: {
      organizationId: orgId,
      incidentId: id,
      authorId: session.user.id,
      authorName: session.user.name ?? session.user.email ?? "Unknown",
      title: parsed.data.title,
      body: parsed.data.body || null,
      url: parsed.data.url || null,
      tag: parsed.data.tag ?? "reference",
    },
  });
  return NextResponse.json(post, { status: 201 });
}
