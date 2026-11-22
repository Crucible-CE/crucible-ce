// @vitest-environment node
// Exercise file storage against Postgres (ce_test) and a temporary storage
// directory: bytes are stored encrypted under a random name, read back
// intact, and deleted with their row.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasTestDb, truncate } from "@/test/exercise-db";

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

describe.skipIf(!hasTestDb)("exercise files (integration)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ce-exercise-files-"));
  beforeAll(async () => {
    process.env.STORAGE_DIR = dir;
    process.env.MASTER_KEK ??= "ab".repeat(32);
    const { __resetStorageForTests } = await import("@/lib/storage/provider");
    __resetStorageForTests();
    await truncate("StoredFile");
  });
  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true });
    const { db } = await import("@/lib/db");
    await db.$disconnect();
  });

  it("stores encrypted bytes under a random name and reads them back", async () => {
    const { saveUpload, readStoredFile, deleteStoredFile, storageKeyFor } = await import("./files");
    const plain = Buffer.from("PLAYBOOK-SECRET the incident commander declares.");
    const row = await saveUpload(plain, { mime: "text/plain", originalName: "../../etc/passwd\u0000.txt" });
    expect(row.originalName).toBe("../../etc/passwd.txt");
    expect(row.path).toMatch(/^c[a-z0-9]{24}$/);
    expect(row.size).toBe(plain.byteLength);

    const stored = filesUnder(dir);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toContain(path.join("exercise-files", row.organizationId, row.path));
    expect(readFileSync(stored[0]).includes(Buffer.from("PLAYBOOK-SECRET"))).toBe(false);

    const back = await readStoredFile(row.id);
    expect(back?.bytes.toString()).toBe(plain.toString());

    expect(() => storageKeyFor(row.organizationId, "../escape")).toThrow();
    expect(await deleteStoredFile(row.id)).toBe(true);
    expect(await readStoredFile(row.id)).toBeNull();
    expect(filesUnder(dir)).toHaveLength(0);
  });
});
