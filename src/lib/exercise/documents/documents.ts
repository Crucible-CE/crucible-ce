// Source document library: create from an upload or pasted text, list, read,
// rename, re-kind, delete. Text comes from src/ingest (PDF and DOCX parse in
// a resource-limited worker thread). Sections come from detectSections.
// SourceDocument.sha256 is the hash of the stored text, the content an
// exercise actually used (the original file keeps its own hash on StoredFile).

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { DetectedFormat } from "@/lib/exercise/ingest/upload";
import { extractPdfText, normalizeExtractedText } from "@/lib/exercise/ingest/pdf";
import { extractDocxText } from "@/lib/exercise/ingest/docx";
import { INGEST_LIMITS, IngestError, assertTextWithinLimit } from "@/lib/exercise/ingest/limits";
import { detectSections, type DocSection } from "@/lib/exercise/ingest/sections";
import { deleteStoredFile, saveUpload } from "@/lib/exercise/files";
import { ServiceError } from "@/lib/exercise/errors";
import { DOCUMENT_KINDS, type DocumentKind } from "./kinds";

/** Exercise statuses that still read their documents. */
export { ACTIVE_EXERCISE_STATUSES } from "./text";

/** Pasted text cap, in characters. */
export const PASTE_MAX_CHARS = 1_000_000;

export const documentMetaSchema = z.object({
  title: z.string().trim().min(1, "Enter a title.").max(200, "Use 200 characters or fewer."),
  kind: z.enum(DOCUMENT_KINDS, { errorMap: () => ({ message: "Pick a document type." }) }),
});

export const pasteDocumentSchema = documentMetaSchema.extend({
  text: z.string().min(1, "Paste the document text.").max(PASTE_MAX_CHARS, "The text is too long. Upload it as a file."),
});

export const updateDocumentSchema = documentMetaSchema
  .partial()
  .refine((v) => v.title !== undefined || v.kind !== undefined, "Nothing to change.");

// cleanText and sha256Hex live in ./text so the boot path can use them
// without loading this module's Next-dependent imports.
export { cleanText, sha256Hex } from "./text";
import { ACTIVE_EXERCISE_STATUSES, cleanText, sha256Hex } from "./text";

/** Extract text from sniffed upload bytes. Throws IngestError with a user message. */
export async function extractDocumentText(bytes: Uint8Array, format: DetectedFormat): Promise<string> {
  switch (format) {
    case "pdf":
      return (await extractPdfText(bytes)).text;
    case "docx":
      return await extractDocxText(bytes);
    case "txt":
    case "md":
    case "vtt": {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      return assertTextWithinLimit(normalizeExtractedText(cleanText(text)));
    }
    default:
      throw new IngestError("unsupported", format);
  }
}

export interface CreateDocumentInput {
  title: string;
  kind: DocumentKind;
  text: string;
  file?: { bytes: Uint8Array; mime: string; originalName: string } | null;
}

export async function createDocument(input: CreateDocumentInput, userId: string | null): Promise<{ id: string; sections: number }> {
  const text = cleanText(input.text).trim();
  if (!text) throw new ServiceError(422, "The document has no text. Upload a file that has text, or paste it.");
  if (text.length > INGEST_LIMITS.maxTextChars) throw new ServiceError(413, "The document is too long. Split it and upload the parts.");
  const sections: DocSection[] = detectSections(text);

  const stored = input.file ? await saveUpload(input.file.bytes, { mime: input.file.mime, originalName: input.file.originalName }) : null;
  try {
    const doc = await db.sourceDocument.create({
      data: {
        title: input.title,
        kind: input.kind,
        text,
        sha256: sha256Hex(text),
        sections: sections as unknown as Prisma.InputJsonValue,
        fileId: stored?.id ?? null,
        createdById: userId,
      },
      select: { id: true },
    });
    return { id: doc.id, sections: sections.length };
  } catch (e) {
    if (stored) await deleteStoredFile(stored.id).catch(() => {});
    throw e;
  }
}

export const DOCUMENT_SCOPES = ["library", "local"] as const;
export type DocumentScope = (typeof DOCUMENT_SCOPES)[number];

/** Library documents ship with CE and are read only. */
export const LIBRARY_READ_ONLY = "Library documents are read only. Duplicate it to edit.";

export async function listDocuments(opts: { kind?: string | null; scope?: DocumentScope | null } = {}) {
  const rows = await db.sourceDocument.findMany({
    where: { ...(opts.kind ? { kind: opts.kind } : {}), ...(opts.scope ? { scope: opts.scope } : {}) },
    orderBy: [{ scope: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      title: true,
      kind: true,
      scope: true,
      collection: true,
      sha256: true,
      sections: true,
      createdAt: true,
      updatedAt: true,
      file: { select: { originalName: true, mime: true, size: true } },
      createdBy: { select: { name: true } },
    },
  });
  return rows.map((d) => ({
    id: d.id,
    title: d.title,
    kind: d.kind,
    scope: d.scope,
    collection: d.collection,
    sha256: d.sha256,
    sectionCount: Array.isArray(d.sections) ? d.sections.length : 0,
    file: d.file ? { name: d.file.originalName, mime: d.file.mime, size: d.file.size } : null,
    createdBy: d.createdBy?.name ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }));
}

export function readSections(raw: unknown): DocSection[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is DocSection =>
      Boolean(s) && typeof s === "object" && typeof (s as DocSection).id === "string" && typeof (s as DocSection).heading === "string",
  );
}

export async function getDocument(id: string) {
  const d = await db.sourceDocument.findUnique({
    where: { id },
    include: {
      file: { select: { id: true, originalName: true, mime: true, size: true } },
      createdBy: { select: { name: true } },
    },
  });
  if (!d) return null;
  return {
    id: d.id,
    title: d.title,
    kind: d.kind,
    scope: d.scope,
    collection: d.collection,
    text: d.text,
    sha256: d.sha256,
    sections: readSections(d.sections),
    file: d.file ? { name: d.file.originalName, mime: d.file.mime, size: d.file.size } : null,
    createdBy: d.createdBy?.name ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export async function updateDocument(id: string, patch: { title?: string; kind?: DocumentKind }): Promise<void> {
  await assertLocal(id);
  const res = await db.sourceDocument.updateMany({
    where: { id, scope: "local" },
    data: { ...(patch.title !== undefined ? { title: patch.title } : {}), ...(patch.kind !== undefined ? { kind: patch.kind } : {}) },
  });
  if (res.count === 0) throw new ServiceError(404, "Document not found.");
}

/** Exercises that have not ended and use the document as source or SOP. */
export async function exercisesUsingDocument(id: string): Promise<Array<{ id: string; title: string; status: string }>> {
  return db.exercise.findMany({
    where: {
      status: { in: ACTIVE_EXERCISE_STATUSES },
      OR: [{ sourceDocumentId: id }, { config: { path: ["sopDocumentId"], equals: id } }],
    },
    select: { id: true, title: true, status: true },
    orderBy: { createdAt: "desc" },
  });
}

/** Templates prepared from the document (they keep their modules if it is deleted). */
export async function templatesFromDocument(id: string): Promise<Array<{ id: string; title: string; status: string }>> {
  return db.exerciseTemplate.findMany({
    where: { mode: "document", config: { path: ["sourceDocumentId"], equals: id } },
    select: { id: true, title: true, status: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function deleteDocument(id: string): Promise<{ title: string }> {
  const doc = await db.sourceDocument.findUnique({ where: { id }, select: { id: true, title: true, fileId: true, scope: true } });
  if (!doc) throw new ServiceError(404, "Document not found.");
  if (doc.scope === "library") throw new ServiceError(409, LIBRARY_READ_ONLY);
  const using = await exercisesUsingDocument(id);
  if (using.length > 0) {
    throw new ServiceError(409, "An exercise that has not ended uses this document. End or delete it first.");
  }
  await db.sourceDocument.delete({ where: { id } });
  if (doc.fileId) {
    const others = await db.sourceDocument.count({ where: { fileId: doc.fileId } });
    if (others === 0) await deleteStoredFile(doc.fileId).catch(() => {});
  }
  return { title: doc.title };
}

async function assertLocal(id: string): Promise<void> {
  const doc = await db.sourceDocument.findUnique({ where: { id }, select: { scope: true } });
  if (!doc) throw new ServiceError(404, "Document not found.");
  if (doc.scope === "library") throw new ServiceError(409, LIBRARY_READ_ONLY);
}

/** Copy a document into the organization's own documents, for example to edit a library playbook. */
export async function duplicateDocument(id: string, userId: string | null): Promise<{ id: string; title: string }> {
  const src = await db.sourceDocument.findUnique({ where: { id }, select: { title: true, kind: true, text: true, sha256: true, sections: true, fileId: true } });
  if (!src) throw new ServiceError(404, "Document not found.");
  const title = `${src.title} (copy)`.slice(0, 200);
  const copy = await db.sourceDocument.create({
    data: {
      title,
      kind: src.kind,
      scope: "local",
      text: src.text,
      sha256: src.sha256,
      sections: src.sections as Prisma.InputJsonValue,
      fileId: src.fileId,
      createdById: userId,
    },
    select: { id: true },
  });
  return { id: copy.id, title };
}
