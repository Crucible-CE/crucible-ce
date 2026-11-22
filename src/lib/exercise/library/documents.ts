// Seeds library playbooks into the install organization's document library as
// read-only library documents (SourceDocument.scope 'library'). Idempotent by
// libraryKey: a missing document is created, a changed shipped version is
// updated in place, and copies the organization made (scope 'local') are
// never touched. An update waits while an exercise that has not ended uses
// the document, so a running exercise keeps the text it started with.

import type { Prisma, PrismaClient } from "@prisma/client";
import { ACTIVE_EXERCISE_STATUSES, cleanText, sha256Hex } from "@/lib/exercise/documents/text";
import { detectSections } from "@/lib/exercise/ingest/sections";
import { installOrgId } from "@/lib/exercise/settings";
import { PLAYBOOK_FILES } from "./playbooks.generated";
import type { LibraryPlaybook } from "./types";

export interface LibraryDocumentSeedResult {
  created: number;
  updated: number;
  unchanged: number;
  /** Changed in the shipped version but in use by an exercise that has not ended. */
  deferred: number;
}

/** The stored text of a library playbook: the Markdown file, cleaned like an upload. */
export function libraryPlaybookText(p: Pick<LibraryPlaybook, "file" | "libraryKey">): string {
  const raw = PLAYBOOK_FILES[p.file];
  if (raw === undefined) throw new Error(`Library playbook ${p.libraryKey}: ${p.file} is not in playbooks.generated.ts. Run npm run library:playbooks.`);
  return cleanText(raw).trim();
}

export async function seedLibraryDocuments(client: PrismaClient, playbooks: readonly LibraryPlaybook[]): Promise<LibraryDocumentSeedResult | null> {
  const organizationId = await installOrgId(client);
  if (!organizationId) return null;
  const result: LibraryDocumentSeedResult = { created: 0, updated: 0, unchanged: 0, deferred: 0 };

  for (const p of playbooks) {
    const text = libraryPlaybookText(p);
    const sha256 = sha256Hex(text);
    const data = {
      title: p.title,
      kind: p.kind,
      collection: p.collection,
      scope: "library",
      text,
      sha256,
      sections: detectSections(text) as unknown as Prisma.InputJsonValue,
    };
    const existing = await client.sourceDocument.findUnique({
      where: { organizationId_libraryKey: { organizationId, libraryKey: p.libraryKey } },
      select: { id: true, sha256: true, title: true, kind: true, collection: true, scope: true },
    });
    if (!existing) {
      await client.sourceDocument.create({ data: { ...data, organizationId, libraryKey: p.libraryKey } });
      result.created++;
      continue;
    }
    const same =
      existing.sha256 === sha256 &&
      existing.title === p.title &&
      existing.kind === p.kind &&
      existing.collection === p.collection &&
      existing.scope === "library";
    if (same) {
      result.unchanged++;
      continue;
    }
    const inUse = await client.exercise.count({
      where: {
        status: { in: ACTIVE_EXERCISE_STATUSES },
        OR: [{ sourceDocumentId: existing.id }, { config: { path: ["sopDocumentId"], equals: existing.id } }],
      },
    });
    if (inUse > 0 && existing.sha256 !== sha256) {
      result.deferred++;
      continue;
    }
    await client.sourceDocument.update({ where: { id: existing.id }, data });
    result.updated++;
  }
  return result;
}
