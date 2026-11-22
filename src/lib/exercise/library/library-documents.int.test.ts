// @vitest-environment node
// Library documents against Postgres (ce_test): seeding is idempotent by
// libraryKey, a changed shipped version updates in place, an update waits
// while an exercise that has not ended uses the document, copies are never
// touched, and library documents are read only.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasTestDb, truncate } from "@/test/exercise-db";
import { db } from "@/lib/db";
import { __resetInstallOrgForTests, installOrgId } from "@/lib/exercise/settings";
import { deleteDocument, duplicateDocument, listDocuments, updateDocument } from "@/lib/exercise/documents/documents";
import { LIBRARY_PLAYBOOKS } from "@/lib/exercise/library";
import { libraryPlaybookText, seedLibraryDocuments } from "./documents";

vi.mock("@/lib/exercise/auth/session", () => ({ getSessionUser: vi.fn().mockResolvedValue(null) }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

describe.skipIf(!hasTestDb)("library documents (integration)", () => {
  beforeEach(async () => {
    await truncate("Exercise", "SourceDocument");
    __resetInstallOrgForTests();
  });

  it("creates each playbook once and leaves it alone on the next run", async () => {
    expect(LIBRARY_PLAYBOOKS.length).toBeGreaterThan(0);
    const first = await seedLibraryDocuments(db as never, LIBRARY_PLAYBOOKS);
    expect(first).toEqual({ created: LIBRARY_PLAYBOOKS.length, updated: 0, unchanged: 0, deferred: 0 });
    const again = await seedLibraryDocuments(db as never, LIBRARY_PLAYBOOKS);
    expect(again).toEqual({ created: 0, updated: 0, unchanged: LIBRARY_PLAYBOOKS.length, deferred: 0 });

    const orgId = await installOrgId(db);
    const rows = await db.sourceDocument.findMany({ where: { scope: "library" } });
    expect(rows).toHaveLength(LIBRARY_PLAYBOOKS.length);
    for (const p of LIBRARY_PLAYBOOKS) {
      const row = rows.find((r) => r.libraryKey === p.libraryKey)!;
      expect(row.organizationId).toBe(orgId);
      expect(row.title).toBe(p.title);
      expect(row.collection).toBe(p.collection);
      expect(row.text).toBe(libraryPlaybookText(p));
      expect(Array.isArray(row.sections) && row.sections.length).toBeGreaterThan(5);
    }
    const listed = await listDocuments({ scope: "library" });
    expect(listed.map((d) => d.scope)).toEqual(LIBRARY_PLAYBOOKS.map(() => "library"));
  });

  it("updates a changed shipped version in place and never touches a copy", async () => {
    await seedLibraryDocuments(db as never, LIBRARY_PLAYBOOKS);
    const p = LIBRARY_PLAYBOOKS[0];
    const lib = await db.sourceDocument.findFirstOrThrow({ where: { libraryKey: p.libraryKey } });
    const copy = await duplicateDocument(lib.id, null);
    await updateDocument(copy.id, { title: "Our hybrid cloud playbook" });

    // Simulate an older shipped version in the database.
    await db.sourceDocument.update({ where: { id: lib.id }, data: { text: "# Old version", sha256: "old", title: "Old title" } });
    const res = await seedLibraryDocuments(db as never, LIBRARY_PLAYBOOKS);
    expect(res?.updated).toBe(1);

    const updated = await db.sourceDocument.findUniqueOrThrow({ where: { id: lib.id } });
    expect(updated.id).toBe(lib.id);
    expect(updated.title).toBe(p.title);
    expect(updated.text).toBe(libraryPlaybookText(p));
    const kept = await db.sourceDocument.findUniqueOrThrow({ where: { id: copy.id } });
    expect(kept.scope).toBe("local");
    expect(kept.libraryKey).toBeNull();
    expect(kept.title).toBe("Our hybrid cloud playbook");
  });

  it("waits to update while an exercise that has not ended uses the document", async () => {
    await seedLibraryDocuments(db as never, LIBRARY_PLAYBOOKS);
    const lib = await db.sourceDocument.findFirstOrThrow({ where: { libraryKey: LIBRARY_PLAYBOOKS[0].libraryKey } });
    await db.sourceDocument.update({ where: { id: lib.id }, data: { text: "# Old version", sha256: "old" } });
    const ex = await db.exercise.create({ data: { mode: "document", title: "Uses the playbook", status: "draft", sourceDocumentId: lib.id } });

    expect((await seedLibraryDocuments(db as never, LIBRARY_PLAYBOOKS))?.deferred).toBe(1);
    expect((await db.sourceDocument.findUniqueOrThrow({ where: { id: lib.id } })).text).toBe("# Old version");

    await db.exercise.update({ where: { id: ex.id }, data: { status: "ended" } });
    expect((await seedLibraryDocuments(db as never, LIBRARY_PLAYBOOKS))?.updated).toBe(1);
  });

  it("keeps library documents read only", async () => {
    await seedLibraryDocuments(db as never, LIBRARY_PLAYBOOKS);
    const lib = await db.sourceDocument.findFirstOrThrow({ where: { scope: "library" } });
    await expect(updateDocument(lib.id, { title: "Renamed" })).rejects.toMatchObject({ status: 409 });
    await expect(deleteDocument(lib.id)).rejects.toMatchObject({ status: 409 });
  });
});
