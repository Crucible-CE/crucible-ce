// @vitest-environment node
// GET evidence download: a stored row typed text/html (legacy / hostile) is
// forced to an octet-stream ATTACHMENT even when ?inline=1 is asked for, and
// every file response carries nosniff + the sandbox CSP + CORP same-origin.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

const h = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockDb: {
    incidentEvidence: { findFirst: vi.fn() },
    incidentEvidenceAccess: { create: vi.fn() },
  },
  mockRead: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: h.mockAuth }));
vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/incident/access", () => ({ findAccessibleIncident: vi.fn().mockResolvedValue({ id: "inc-1" }) }));
vi.mock("@/lib/evidence/storage", () => ({ readEvidence: h.mockRead }));

import { GET } from "./route";
import { FILE_RESPONSE_CSP } from "@/lib/http/file-response";

const params = Promise.resolve({ id: "inc-1", evidenceId: "ev-1" });
const html = Buffer.from("<html><script>alert(document.cookie)</script></html>");

beforeEach(() => {
  vi.clearAllMocks();
  h.mockAuth.mockResolvedValue({ user: { id: "u-1", organizationId: "org-1", role: "reader" } });
  h.mockRead.mockResolvedValue(html);
  h.mockDb.incidentEvidenceAccess.create.mockResolvedValue({});
});

function row(mimeType: string, filename = "x.html") {
  return { id: "ev-1", filename, mimeType, sha256: createHash("sha256").update(html).digest("hex") };
}

describe("GET evidence download", () => {
  it("forces a stored text/html row to an octet-stream attachment, even with ?inline=1", async () => {
    h.mockDb.incidentEvidence.findFirst.mockResolvedValue(row("text/html"));
    const res = await GET(new Request("http://x/api/incidents/inc-1/evidence/ev-1?inline=1"), { params });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe(FILE_RESPONSE_CSP);
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(res.headers.get("x-evidence-integrity")).toBe("verified");
  });

  it("never inlines a PDF or SVG", async () => {
    for (const t of ["application/pdf", "image/svg+xml"]) {
      h.mockDb.incidentEvidence.findFirst.mockResolvedValueOnce(row(t, "f"));
      const res = await GET(new Request("http://x/e?inline=1"), { params });
      expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    }
  });

  it("inlines an allowlisted image only when asked", async () => {
    h.mockDb.incidentEvidence.findFirst.mockResolvedValue(row("image/png", "a.png"));
    const inline = await GET(new Request("http://x/e?inline=1"), { params });
    expect(inline.headers.get("content-type")).toBe("image/png");
    expect(inline.headers.get("content-disposition")).toMatch(/^inline;/);
    const dl = await GET(new Request("http://x/e"), { params });
    expect(dl.headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it("sanitizes a hostile filename in Content-Disposition", async () => {
    h.mockDb.incidentEvidence.findFirst.mockResolvedValue(row("text/plain", 'a"\r\nSet-Cookie: x=1.txt'));
    const res = await GET(new Request("http://x/e"), { params });
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).not.toMatch(/[\r\n]/);
    expect(cd).not.toContain('a"');
  });
});
