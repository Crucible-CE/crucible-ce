import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const create = vi.fn();
vi.mock("@/lib/db", () => ({ db: { adminAuditLog: { create: (...a: unknown[]) => create(...a) } } }));

import { recordAdminAuditLog } from "./admin-audit";

describe("recordAdminAuditLog", () => {
  beforeEach(() => create.mockReset().mockResolvedValue({}));

  it("writes organizationId to the top-level column the org audit view filters on", async () => {
    await recordAdminAuditLog({
      actorUserId: "u1",
      organizationId: "org-1",
      action: "org_invite.create",
      targetType: "org_invite",
      metadata: { organizationId: "org-1" },
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: "org-1", action: "org_invite.create" }),
    });
  });
});

// Every call site must pass a top-level `organizationId` (the type requires it;
// this guards against an `as` cast or a spread silently dropping it).
describe("recordAdminAuditLog call sites", () => {
  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? walk(p) : /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
    });
  }
  const root = path.resolve(__dirname, "..");
  const sites = walk(root).flatMap((file) => {
    const src = fs.readFileSync(file, "utf8");
    const out: { file: string; block: string }[] = [];
    let i = 0;
    while ((i = src.indexOf("recordAdminAuditLog({", i)) >= 0) {
      const end = src.indexOf("});", i);
      out.push({ file: path.relative(root, file), block: src.slice(i, end) });
      i = end;
    }
    return out;
  });

  it("finds the call sites", () => {
    expect(sites.length).toBeGreaterThan(0);
  });

  it.each(sites.map((s) => [s.file, s.block] as const))("%s passes top-level organizationId", (_file, block) => {
    // Strip the metadata object so an organizationId nested there doesn't count.
    const withoutMetadata = block.replace(/metadata:\s*\{[\s\S]*?\}/, "");
    expect(withoutMetadata).toMatch(/\borganizationId\s*[:,]/);
  });
});
