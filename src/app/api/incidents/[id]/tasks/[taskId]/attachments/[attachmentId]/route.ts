import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { readEvidence } from "@/lib/evidence/storage";
import { findAccessibleIncident } from "@/lib/incident/access";
import { fileResponse } from "@/lib/http/file-response";

interface RouteContext {
  params: Promise<{ id: string; taskId: string; attachmentId: string }>;
}

// GET — download a ticket attachment (?inline=1 to preview in-browser).
export async function GET(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id, taskId, attachmentId } = await context.params;
  const orgId = session.user.organizationId;
  if (!(await findAccessibleIncident(session.user, id, { id: true }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const att = await db.incidentTaskAttachment.findFirst({
    where: { id: attachmentId, taskId, incidentId: id, organizationId: orgId },
    select: { id: true, filename: true, mimeType: true },
  });
  if (!att) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let buf: Buffer;
  try {
    buf = await readEvidence(orgId, id, att.id);
  } catch {
    return NextResponse.json({ error: "File unavailable" }, { status: 404 });
  }

  const inline = new URL(req.url).searchParams.get("inline") === "1";
  // Inline only for passive allowlisted types (lib/http/file-response).
  return fileResponse(buf, { filename: att.filename, contentType: att.mimeType, inline });
}
