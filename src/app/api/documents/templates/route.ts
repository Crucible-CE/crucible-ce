// GET /api/documents/templates   Playbook Exercise templates, no secret content. ?documentId= filters.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireTemplateManager } from "../_lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await requireTemplateManager();
  if (!a.ok) return a.response;
  const documentId = new URL(req.url).searchParams.get("documentId");
  const rows = await db.exerciseTemplate.findMany({
    where: { mode: "document", ...(documentId ? { config: { path: ["sourceDocumentId"], equals: documentId } } : {}) },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, status: true, version: true, config: true, updatedAt: true, _count: { select: { injects: true } } },
  });
  return NextResponse.json(
    {
      templates: rows.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        version: t.version,
        modules: t._count.injects,
        updatedAt: t.updatedAt,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
