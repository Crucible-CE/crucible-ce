import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));

const mockHasPermission = vi.fn();
vi.mock("@/lib/auth/rbac", () => ({ hasPermission: mockHasPermission }));

const mockDb = {
  user: {
    findUnique: vi.fn(),
  },
  incident: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({ db: mockDb }));

function makeSession() {
  return {
    user: {
      id: "u-1",
      email: "user@example.com",
      organizationId: "org-1",
      role: "contributor",
    },
  };
}

function makePostRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/incidents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/incidents pagination", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockHasPermission.mockReset();
    mockDb.incident.findMany.mockReset();
    mockAuth.mockResolvedValue(makeSession());
    mockHasPermission.mockReturnValue(true);
  });

  const inc = (id: string) => ({ id, title: `Incident ${id}` });

  it("no params → legacy bare array bounded at 100", async () => {
    mockDb.incident.findMany.mockResolvedValueOnce([inc("i-3"), inc("i-2")]);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/incidents"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);

    const args = mockDb.incident.findMany.mock.calls[0][0];
    expect(args.take).toBe(100);
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(args.where.id).toBeUndefined();
    // Access filter still applied on the legacy path.
    expect(args.where.organizationId).toBe("org-1");
  });

  it("?take=2 → envelope with take+1 fetch, nextCursor from last kept row", async () => {
    mockDb.incident.findMany.mockResolvedValueOnce([inc("i-3"), inc("i-2"), inc("i-1")]);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/incidents?take=2"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body.items.map((r: { id: string }) => r.id)).toEqual(["i-3", "i-2"]);
    expect(body.nextCursor).toBe("i-2");

    const args = mockDb.incident.findMany.mock.calls[0][0];
    expect(args.take).toBe(3); // take + 1 look-ahead
    expect(args.where.id).toBeUndefined(); // first page: no boundary
  });

  it("following the cursor bounds the next page and terminates", async () => {
    mockDb.incident.findMany.mockResolvedValueOnce([inc("i-1")]);

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/incidents?take=2&cursor=i-2"),
    );

    const body = await response.json();
    expect(body.items.map((r: { id: string }) => r.id)).toEqual(["i-1"]);
    expect(body.nextCursor).toBeNull();

    const args = mockDb.incident.findMany.mock.calls[0][0];
    expect(args.where.id).toEqual({ lt: "i-2" });
    expect(args.where.organizationId).toBe("org-1"); // access filter survives paging
  });
});

describe("POST /api/incidents assignment policy", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockHasPermission.mockReset();
    mockDb.user.findUnique.mockReset();
    mockDb.incident.create.mockReset();
  });

  it("returns 403 when caller lacks incidents.edit permission", async () => {
    mockAuth.mockResolvedValueOnce(makeSession());
    mockHasPermission.mockReturnValue(false);

    const { POST } = await import("./route");
    const response = await POST(
      makePostRequest({
        title: "Incident",
        description: "desc",
      })
    );

    expect(response.status).toBe(403);
    expect(mockDb.incident.create).not.toHaveBeenCalled();
  });

  it("blocks a cross-org assignee", async () => {
    mockAuth.mockResolvedValueOnce(makeSession());
    mockHasPermission.mockImplementation((_user, permission: string) => permission === "incidents.edit");
    mockDb.user.findUnique.mockResolvedValueOnce({
      id: "u-2",
      organizationId: "org-2",
      isActive: true,
    });

    const { POST } = await import("./route");
    const response = await POST(
      makePostRequest({
        title: "Incident",
        description: "desc",
        assignedToId: "u-2",
      })
    );

    expect(response.status).toBe(403);
    expect(mockDb.incident.create).not.toHaveBeenCalled();
  });

  it("allows a same-org active assignee", async () => {
    mockAuth.mockResolvedValueOnce(makeSession());
    mockHasPermission.mockImplementation((_user, permission: string) => permission === "incidents.edit");
    mockDb.user.findUnique.mockResolvedValueOnce({
      id: "u-2",
      organizationId: "org-1",
      isActive: true,
    });
    mockDb.incident.create.mockResolvedValueOnce({ id: "inc-1", title: "Incident" });

    const { POST } = await import("./route");
    const response = await POST(
      makePostRequest({
        title: "Incident",
        description: "desc",
        assignedToId: "u-2",
      })
    );

    expect(response.status).toBe(201);
    expect(mockDb.incident.create).toHaveBeenCalledOnce();
  });
});
