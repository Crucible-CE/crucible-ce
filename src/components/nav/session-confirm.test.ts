import { describe, it, expect, vi } from "vitest";
import { confirmSessionState } from "./session-confirm";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("confirmSessionState", () => {
  it("reports signed-out only when the server answers with no session", async () => {
    expect(await confirmSessionState({ fetch: async () => json(null) })).toBe("signed-out");
    expect(await confirmSessionState({ fetch: async () => json({}) })).toBe("signed-out");
    expect(await confirmSessionState({ fetch: async () => json({ error: "x" }, 401), attempts: 1 })).toBe("signed-out");
  });

  it("reports signed-in when the server still has a session", async () => {
    const f = vi.fn(async () => json({ user: { id: "u1" }, expires: "2099-01-01" }));
    expect(await confirmSessionState({ fetch: f })).toBe("signed-in");
    expect(f).toHaveBeenCalledWith("/api/auth/session", expect.objectContaining({ cache: "no-store" }));
  });

  it("treats an aborted / failed fetch as unknown, never as signed-out", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await confirmSessionState({ fetch: f, attempts: 2, delayMs: 0 })).toBe("unknown");
    expect(f).toHaveBeenCalledTimes(2);
    expect(await confirmSessionState({ fetch: async () => json({ error: "db" }, 500), attempts: 1 })).toBe("unknown");
  });

  it("retries after a transient failure", async () => {
    const f = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(json({ user: { id: "u1" } }));
    expect(await confirmSessionState({ fetch: f, delayMs: 0 })).toBe("signed-in");
  });
});
