// Cron lock: Redis SET NX when available, the in-process lock otherwise.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const createClient = vi.fn();
vi.mock("redis", () => ({
  createClient: (opts: unknown) => createClient(opts),
}));

// Only the key prefix is stubbed so assertions don't depend on the ambient environment.
vi.mock("@/lib/db/redis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/redis")>();
  return { ...actual, rkey: (key: string) => `test:${key}` };
});

interface FakeClient {
  on: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
}

function makeClient(overrides: Partial<FakeClient> = {}): FakeClient {
  const client: FakeClient = {
    on: vi.fn(),
    connect: vi.fn(),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
    ...overrides,
  };
  client.connect.mockResolvedValue(client);
  return client;
}

/** Fresh module instance — `withCronLock` caches its Redis promise at module scope. */
async function loadCronLock() {
  vi.resetModules();
  return (await import("./cron-lock")).withCronLock;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  createClient.mockReset();
  delete process.env.REDIS_URL;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("with Redis", () => {
  it("runs the body when the lock is acquired, then releases it", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const client = makeClient();
    createClient.mockReturnValue(client);
    const withCronLock = await loadCronLock();
    const body = vi.fn().mockResolvedValue(undefined);

    await withCronLock("digest-flush", 60, body);

    expect(body).toHaveBeenCalledTimes(1);
    expect(client.set).toHaveBeenCalledWith("test:cron:lock:digest-flush", expect.any(String), {
      NX: true,
      EX: 60,
    });
    expect(client.del).toHaveBeenCalledWith("test:cron:lock:digest-flush");
  });

  it("does not run the body when the lock is already held", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    createClient.mockReturnValue(makeClient({ set: vi.fn().mockResolvedValue(null) }));
    const withCronLock = await loadCronLock();
    const body = vi.fn().mockResolvedValue(undefined);

    await withCronLock("digest-flush", 60, body);

    expect(body).not.toHaveBeenCalled();
  });
});

describe("without Redis (in-process lock)", () => {
  it("uses the process-local lock when REDIS_URL is unset", async () => {
    const withCronLock = await loadCronLock();
    const body = vi.fn().mockResolvedValue(undefined);

    await withCronLock("digest-flush", 60, body);

    expect(body).toHaveBeenCalledTimes(1);
  });

  it("falls back to the in-process lock when Redis errors", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    createClient.mockReturnValue(
      makeClient({ set: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) }),
    );
    const withCronLock = await loadCronLock();
    const body = vi.fn().mockResolvedValue(undefined);

    await withCronLock("digest-flush", 60, body);

    expect(body).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalled();
  });

  it("prevents re-entrant local runs of the same job", async () => {
    const withCronLock = await loadCronLock();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const body = vi.fn().mockImplementation(() => gate);

    const first = withCronLock("slow-job", 60, body);
    await withCronLock("slow-job", 60, body); // overlapping tick — must no-op
    release?.();
    await first;

    expect(body).toHaveBeenCalledTimes(1);
  });
});
