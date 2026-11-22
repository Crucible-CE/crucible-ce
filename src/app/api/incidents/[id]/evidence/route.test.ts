// @vitest-environment node
// POST /api/incidents/[id]/evidence — the stored content type comes from the
// bytes (safeStoredMimeType), never the client; oversized bodies are refused
// before they're buffered; and the read-only lock applies.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockDb: {
    incident: { findFirst: vi.fn(), findUnique: vi.fn() },
    incidentRoleAssignment: { findFirst: vi.fn() },
    incidentEvidence: { create: vi.fn(), delete: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  },
}));
vi.mock("@/lib/auth", () => ({ auth: h.mockAuth }));
vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/ledger/append", () => ({ appendLedger: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/evidence/storage", () => ({ writeEvidence: vi.fn().mockResolvedValue(undefined), deleteEvidence: vi.fn() }));

import { POST } from "./route";

const { mockAuth, mockDb } = h;
const params = Promise.resolve({ id: "inc-1" });
const session = { user: { id: "u-1", name: "U", organizationId: "org-1", role: "contributor" } };

function upload(bytes: Uint8Array<ArrayBuffer> | string, name: string, type: string) {
  const fd = new FormData();
  fd.append("file", new File([bytes], name, { type }));
  return new Request("http://x/api/incidents/inc-1/evidence", { method: "POST", body: fd });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.MAX_ATTACHMENT_BYTES;
  mockAuth.mockResolvedValue(session);
  mockDb.incident.findFirst.mockResolvedValue({ id: "inc-1" });
  mockDb.incident.findUnique.mockResolvedValue({ restricted: false });
  mockDb.incidentRoleAssignment.findFirst.mockResolvedValue(null);
  mockDb.incidentEvidence.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "ev-1", ...data }));
});

describe("POST evidence — stored mime type", () => {
  it("stores an uploaded text/html file as application/octet-stream", async () => {
    const res = await POST(upload("<html><script>alert(1)</script></html>", "x.html", "text/html"), { params });
    expect(res.status).toBe(201);
    expect(mockDb.incidentEvidence.create.mock.calls[0]![0].data.mimeType).toBe("application/octet-stream");
  });

  it("stores an SVG claimed as image/svg+xml as application/octet-stream", async () => {
    const res = await POST(upload('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "x.svg", "image/svg+xml"), { params });
    expect(res.status).toBe(201);
    expect(mockDb.incidentEvidence.create.mock.calls[0]![0].data.mimeType).toBe("application/octet-stream");
  });

  it("stores a real PNG as image/png even if the client lies about the type", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const res = await POST(upload(png, "shot.png", "text/html"), { params });
    expect(res.status).toBe(201);
    expect(mockDb.incidentEvidence.create.mock.calls[0]![0].data.mimeType).toBe("image/png");
  });

  it("413s an oversized upload before buffering it (declared or streamed length), no row written", async () => {
    process.env.MAX_ATTACHMENT_BYTES = "1024";
    const fd = new FormData();
    fd.append("file", new File(["x".repeat(200_000)], "big.txt", { type: "text/plain" }));
    const encoded = new Response(fd);
    const contentType = encoded.headers.get("content-type")!;
    const body = new Uint8Array(await encoded.arrayBuffer());
    const variants: Record<string, string>[] = [{ "content-type": contentType, "content-length": String(body.byteLength) }, { "content-type": contentType }];
    for (const headers of variants) {
      const res = await POST(new Request("http://x", { method: "POST", headers, body }), { params });
      expect(res.status).toBe(413);
    }
    expect(mockDb.incidentEvidence.create).not.toHaveBeenCalled();
  });

  it("403s incident_locked for a non-IC, non-admin on a locked incident (no row written)", async () => {
    mockDb.incident.findUnique.mockResolvedValue({ restricted: true });
    const res = await POST(upload("hello", "a.txt", "text/plain"), { params });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("incident_locked");
    expect(mockDb.incidentEvidence.create).not.toHaveBeenCalled();
  });
});
