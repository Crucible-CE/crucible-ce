// GET  /api/documents            list (any signed-in user). ?kind=sop and ?scope=library|local filter.
// POST /api/documents            create (documents.manage)
//      multipart/form-data       file (PDF, DOCX, MD, TXT), title, kind
//      application/json          {title, kind, text}   pasted text
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { readUpload } from "@/lib/exercise/ingest/upload";
import { IngestError } from "@/lib/exercise/ingest/limits";
import { withErrors } from "@/lib/exercise/errors";
import {
  DOCUMENT_SCOPES,
  createDocument,
  documentMetaSchema,
  extractDocumentText,
  listDocuments,
  pasteDocumentSchema,
  type DocumentScope,
} from "@/lib/exercise/documents/documents";
import { ensureExerciseLibrary } from "@/lib/exercise/library";
import { isDocumentKind } from "@/lib/exercise/documents/kinds";
import { hourlyLimit, requireDocumentManager, requireDocumentReader } from "./_lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await requireDocumentReader();
  if (!a.ok) return a.response;
  const params = new URL(req.url).searchParams;
  const kind = params.get("kind");
  const scope = params.get("scope");
  if (kind && !isDocumentKind(kind)) return NextResponse.json({ error: "Unknown document type." }, { status: 400 });
  if (scope && !(DOCUMENT_SCOPES as readonly string[]).includes(scope)) return NextResponse.json({ error: "Unknown scope." }, { status: 400 });
  await ensureExerciseLibrary();
  const documents = await listDocuments({ kind, scope: scope as DocumentScope | null });
  return NextResponse.json({ documents }, { headers: { "Cache-Control": "no-store" } });
}

function titleFromName(name: string): string {
  const base = name.replace(/\.[A-Za-z0-9]{1,10}$/, "").replace(/[_]+/g, " ").trim();
  return (base || "Untitled document").slice(0, 200);
}

export async function POST(req: Request) {
  return withErrors(async () => {
    const a = await requireDocumentManager();
    if (!a.ok) return a.response;
    const limited = await hourlyLimit(a.user.id, "documents:create", 60);
    if (limited) return limited;

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.toLowerCase().startsWith("multipart/form-data")) {
      const up = await readUpload(req, "document");
      if (!up.ok) return up.response;
      const meta = documentMetaSchema.safeParse({
        title: up.form.getString("title")?.trim() || titleFromName(up.file.name),
        kind: up.form.getString("kind") || "other",
      });
      if (!meta.success) return NextResponse.json({ error: "Invalid input", details: meta.error.flatten() }, { status: 400 });
      let text: string;
      try {
        text = await extractDocumentText(up.file.bytes, up.detected.format);
      } catch (e) {
        if (e instanceof IngestError) return NextResponse.json({ error: e.userMessage }, { status: 422 });
        throw e;
      }
      const created = await createDocument(
        { ...meta.data, text, file: { bytes: up.file.bytes, mime: up.detected.mime, originalName: up.file.name } },
        a.user.id,
      );
      audit({
        actorUserId: a.user.id,
        action: "document.uploaded",
        targetType: "SourceDocument",
        targetId: created.id,
        data: { kind: meta.data.kind, format: up.detected.format, bytes: up.file.size, sections: created.sections },
        req,
      });
      return NextResponse.json({ id: created.id }, { status: 201 });
    }

    const parsed = await parseJsonBody(req, pasteDocumentSchema, { maxBytes: 4 * 1024 * 1024 });
    if (!parsed.ok) return parsed.response;
    const created = await createDocument({ title: parsed.data.title, kind: parsed.data.kind, text: parsed.data.text }, a.user.id);
    audit({
      actorUserId: a.user.id,
      action: "document.created",
      targetType: "SourceDocument",
      targetId: created.id,
      data: { kind: parsed.data.kind, source: "paste", chars: parsed.data.text.length, sections: created.sections },
      req,
    });
    return NextResponse.json({ id: created.id }, { status: 201 });
  });
}
