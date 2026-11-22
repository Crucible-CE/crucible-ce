import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockUsersWithIncidentAccess = vi.fn();

vi.mock("./access", () => ({
  usersWithIncidentAccess: (...a: unknown[]) => mockUsersWithIncidentAccess(...a),
}));

import { evictFromIncidentRoom, disconnectUserSockets, userSessionRoom } from "./evict";

interface FakeSocket {
  id: string;
  data: { auth?: { userId: string } };
  leave: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
}

function fakeSocket(id: string, userId?: string): FakeSocket {
  return {
    id,
    data: userId ? { auth: { userId } } : {},
    leave: vi.fn(),
    emit: vi.fn(),
  };
}

const g = globalThis as unknown as { __crucibleCe_io?: unknown };

function installIO(sockets: FakeSocket[]) {
  const fetchSockets = vi.fn().mockResolvedValue(sockets);
  const warRoomDisconnect = vi.fn();
  const rootDisconnect = vi.fn();
  const warRoomIn = vi.fn(() => ({ fetchSockets, disconnectSockets: warRoomDisconnect }));
  const of = vi.fn(() => ({ in: warRoomIn }));
  const rootIn = vi.fn(() => ({ disconnectSockets: rootDisconnect }));
  g.__crucibleCe_io = { of, in: rootIn };
  return { of, warRoomIn, rootIn, fetchSockets, warRoomDisconnect, rootDisconnect };
}

describe("evictFromIncidentRoom", () => {
  beforeEach(() => {
    mockUsersWithIncidentAccess.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    delete g.__crucibleCe_io;
    vi.restoreAllMocks();
  });

  it("is a no-op when no Socket.io server is registered in this process", async () => {
    expect(await evictFromIncidentRoom("i1", { recheckAll: true })).toBe(0);
    expect(mockUsersWithIncidentAccess).not.toHaveBeenCalled();
  });

  it("removed participant: only that user's sockets are rechecked and evicted", async () => {
    const a1 = fakeSocket("a1", "alice");
    const a2 = fakeSocket("a2", "alice");
    const b = fakeSocket("b", "bob");
    const io = installIO([a1, a2, b]);
    mockUsersWithIncidentAccess.mockResolvedValueOnce(new Set());

    expect(await evictFromIncidentRoom("i1", { userIds: ["alice"] })).toBe(2);

    expect(io.of).toHaveBeenCalledWith("/war-room");
    expect(io.warRoomIn).toHaveBeenCalledWith("incident:i1");
    expect(mockUsersWithIncidentAccess).toHaveBeenCalledWith("i1", ["alice", "alice"]);
    for (const s of [a1, a2]) {
      expect(s.leave).toHaveBeenCalledWith("incident:i1");
      expect(s.emit).toHaveBeenCalledWith("incident:access_revoked", { incidentId: "i1" });
    }
    expect(b.leave).not.toHaveBeenCalled();
    expect(b.emit).not.toHaveBeenCalled();
  });

  it("removed participant who still has access (e.g. admin/IC/assignee) stays", async () => {
    const a = fakeSocket("a", "alice");
    installIO([a]);
    mockUsersWithIncidentAccess.mockResolvedValueOnce(new Set(["alice"]));
    expect(await evictFromIncidentRoom("i1", { userIds: ["alice"] })).toBe(0);
    expect(a.leave).not.toHaveBeenCalled();
  });

  it("lock (recheckAll): every socket is rechecked; only those who lost access leave", async () => {
    const admin = fakeSocket("s1", "admin");
    const part = fakeSocket("s2", "part");
    const stranger = fakeSocket("s3", "stranger");
    const anon = fakeSocket("s4");
    installIO([admin, part, stranger, anon]);
    mockUsersWithIncidentAccess.mockResolvedValueOnce(new Set(["admin", "part"]));

    expect(await evictFromIncidentRoom("i1", { recheckAll: true })).toBe(2);

    expect(mockUsersWithIncidentAccess).toHaveBeenCalledWith("i1", ["admin", "part", "stranger"]);
    expect(admin.leave).not.toHaveBeenCalled();
    expect(part.leave).not.toHaveBeenCalled();
    expect(stranger.leave).toHaveBeenCalledWith("incident:i1");
    expect(stranger.emit).toHaveBeenCalledWith("incident:access_revoked", { incidentId: "i1" });
    expect(anon.leave).toHaveBeenCalledWith("incident:i1");
  });

  it("nothing to recheck → no fetch, no DB", async () => {
    const io = installIO([]);
    expect(await evictFromIncidentRoom("i1", { userIds: [] })).toBe(0);
    expect(io.fetchSockets).not.toHaveBeenCalled();
    expect(mockUsersWithIncidentAccess).not.toHaveBeenCalled();
  });

  it("never throws: fetchSockets failure (e.g. Redis timeout) is logged and swallowed", async () => {
    const io = installIO([]);
    io.fetchSockets.mockRejectedValueOnce(new Error("timeout reached while waiting for fetchSockets response"));
    await expect(evictFromIncidentRoom("i1", { recheckAll: true })).resolves.toBe(0);
    expect(console.error).toHaveBeenCalled();
  });

  it("never throws: DB failure during recheck is logged and swallowed", async () => {
    installIO([fakeSocket("a", "alice")]);
    mockUsersWithIncidentAccess.mockRejectedValueOnce(new Error("db down"));
    await expect(evictFromIncidentRoom("i1", { recheckAll: true })).resolves.toBe(0);
  });
});

describe("disconnectUserSockets", () => {
  afterEach(() => {
    delete g.__crucibleCe_io;
    vi.restoreAllMocks();
  });

  it("disconnects the user's session room in both namespaces", () => {
    const io = installIO([]);
    disconnectUserSockets("u1");
    expect(io.rootIn).toHaveBeenCalledWith(userSessionRoom("u1"));
    expect(io.rootDisconnect).toHaveBeenCalledWith(true);
    expect(io.of).toHaveBeenCalledWith("/war-room");
    expect(io.warRoomIn).toHaveBeenCalledWith("session:u1");
    expect(io.warRoomDisconnect).toHaveBeenCalledWith(true);
  });

  it("is a no-op without a server and never throws", () => {
    expect(() => disconnectUserSockets("u1")).not.toThrow();
    g.__crucibleCe_io = {
      in: () => {
        throw new Error("boom");
      },
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => disconnectUserSockets("u1")).not.toThrow();
  });
});
