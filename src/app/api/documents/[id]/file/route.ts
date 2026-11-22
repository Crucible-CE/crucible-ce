// GET /api/documents/{id}/file   the original upload, always as an attachment
// unless ?inline=1 and the type is inline safe (src/http/file-response.ts).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fileResponse } from "@/lib/http/file-response";
import { readStoredFile } from "@/lib/exercise/files";
import { DOC_NOT_FOUND, requireDocumentReader } from "../../_lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requireDocumentReader();
  if (!a.ok) return a.response;
  const { id } = await ctx.params;
  const doc = await db.sourceDocument.findUnique({ where: { id }, select: { fileId: true } });
  if (!doc) return NextResponse.json(DOC_NOT_FOUND, { status: 404 });
  if (!doc.fileId) return NextResponse.json({ error: "This document was pasted. There is no file to download." }, { status: 404 });
  const stored = await readStoredFile(doc.fileId);
  if (!stored) return NextResponse.json({ error: "The file is missing from storage." }, { status: 404 });
  const inline = new URL(req.url).searchParams.get("inline") === "1";
  return fileResponse(stored.bytes, { filename: stored.file.originalName, contentType: stored.file.mime, inline });
}
