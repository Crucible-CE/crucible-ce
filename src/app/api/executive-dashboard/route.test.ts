// @vitest-environment node
// Who may read the executive dashboard. Readers get 403 before any query runs.
import { beforeEach, describe, expect, it, vi } from "vitest";

const build = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/exercise/program/executive", () => ({ buildExecutiveDashboard: (...a: unknown[]) => build(...a) }));
vi.mock("@/lib/exercise/program/executive-pdf", () => ({ renderExecutivePdf: vi.fn() }));
vi.mock("@/lib/exercise/audit", () => ({ audit: vi.fn() }));

import { auth } from "@/lib/auth";
import { GET } from "./route";

function as(role: string | null) {
  vi.mocked(auth).mockResolvedValue((role ? { user: { id: "u1", name: "A", email: "a@example.test", organizationId: "org1", role }, expires: "2999-01-01" } : null) as never);
}

const req = () => new Request("http://x/api/executive-dashboard");

beforeEach(() => {
  vi.clearAllMocks();
  build.mockResolvedValue({ generatedAt: "2026-10-26T00:00:00.000Z", window: { from: "", to: "" } });
});

describe("GET /api/executive-dashboard", () => {
  it("is 401 signed out and 403 for readers", async () => {
    as(null);
    expect((await GET(req())).status).toBe(401);
    as("reader");
    expect((await GET(req())).status).toBe(403);
    expect(build).not.toHaveBeenCalled();
  });

  it.each([
    ["contributor", "contributor"],
    ["exercise_director", "exercise_director"],
    ["administrator", "administrator"],
  ])("is 200 for %s and counts incidents as that CE role", async (role, ceRole) => {
    as(role);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(build.mock.calls[0][0]).toEqual({ id: "u1", organizationId: "org1", role: ceRole });
  });
});
