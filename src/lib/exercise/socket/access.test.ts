// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeRooms, decideRooms, setRoomAuthorizer, type SocketPrincipal } from "./access";

const user: SocketPrincipal = { kind: "user", userId: "u1", role: "facilitator" };
const guest: SocketPrincipal = { kind: "guest", exerciseId: "ex1", participantId: "p9" };

afterEach(() => setRoomAuthorizer(null));

describe("decideRooms", () => {
  it("maps a grant to room names", () => {
    expect(decideRooms(user, "ex1", { all: true, control: true, teamIds: ["t1"], participantId: "p1" })).toEqual([
      "ex:ex1:all",
      "ex:ex1:control",
      "ex:ex1:team:t1",
      "participant:p1",
    ]);
  });

  it("null grant or empty grant denies", () => {
    expect(decideRooms(user, "ex1", null)).toEqual([]);
    expect(decideRooms(user, "ex1", { all: false })).toEqual([]);
  });

  it("a guest never gets the control room or another exercise, whatever the authorizer says", () => {
    expect(decideRooms(guest, "ex1", { all: true, control: true, teamIds: ["t2"] })).toEqual(["ex:ex1:all", "ex:ex1:team:t2", "participant:p9"]);
    expect(decideRooms(guest, "ex2", { all: true, control: true })).toEqual([]);
  });

  it("drops malformed team ids", () => {
    expect(decideRooms(user, "ex1", { all: true, teamIds: ["ok", "bad id", "../x"] })).toEqual(["ex:ex1:all", "ex:ex1:team:ok"]);
  });
});

describe("authorizeRooms", () => {
  it("denies by default (no authorizer registered)", async () => {
    expect(await authorizeRooms(user, "ex1")).toEqual([]);
  });

  it("uses the registered authorizer, and a throwing authorizer denies", async () => {
    setRoomAuthorizer(async (p, id) => (p.kind === "user" && id === "ex1" ? { all: true } : null));
    expect(await authorizeRooms(user, "ex1")).toEqual(["ex:ex1:all"]);
    expect(await authorizeRooms(user, "ex2")).toEqual([]);
    setRoomAuthorizer(async () => {
      throw new Error("boom");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await authorizeRooms(user, "ex1")).toEqual([]);
  });

  it("rejects malformed exercise ids before calling the authorizer", async () => {
    const fn = vi.fn();
    setRoomAuthorizer(fn);
    expect(await authorizeRooms(user, "../../etc")).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});
