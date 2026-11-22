// In-memory stand-in for the parts of Prisma the password reset flows touch
// (VerificationToken + User), so the tests run the real token issue and
// consume code against one shared store. Use it from a test file with:
//
//   vi.mock("@/lib/db", async () => (await import("@/test/reset-db")).dbModule);
//
// and reset it in beforeEach with resetDb.reset().

import { vi } from "vitest";

export interface FakeUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  isActive: boolean;
  organizationId: string;
  passwordHash: string | null;
  tokenVersion: number;
}

interface TokenRow {
  identifier: string;
  token: string;
  expires: Date;
}

const tokens = new Map<string, TokenRow>();
const users = new Map<string, FakeUser>();

function findUser(where: { id?: string; email?: string }): FakeUser | null {
  if (where.id) return users.get(where.id) ?? null;
  return [...users.values()].find((u) => u.email === where.email) ?? null;
}

const db = {
  verificationToken: {
    deleteMany: vi.fn(({ where }: { where: { identifier: string } }) => {
      let count = 0;
      for (const [k, row] of tokens) {
        if (row.identifier === where.identifier) {
          tokens.delete(k);
          count++;
        }
      }
      return Promise.resolve({ count });
    }),
    create: vi.fn(({ data }: { data: TokenRow }) => {
      tokens.set(data.token, { ...data });
      return Promise.resolve({ ...data });
    }),
    findUnique: vi.fn(({ where }: { where: { token: string } }) => Promise.resolve(tokens.get(where.token) ?? null)),
    delete: vi.fn(({ where }: { where: { token: string } }) => {
      const row = tokens.get(where.token);
      if (!row) return Promise.reject(new Error("Record to delete does not exist."));
      tokens.delete(where.token);
      return Promise.resolve(row);
    }),
  },
  user: {
    findUnique: vi.fn(({ where }: { where: { id?: string; email?: string } }) => Promise.resolve(findUser(where))),
    update: vi.fn(({ where, data }: { where: { id?: string; email?: string }; data: Record<string, unknown> }) => {
      const u = findUser(where);
      if (!u) return Promise.reject(new Error("Record to update not found."));
      for (const [k, v] of Object.entries(data)) {
        if (k === "tokenVersion" && v && typeof v === "object" && "increment" in v) u.tokenVersion += (v as { increment: number }).increment;
        else (u as unknown as Record<string, unknown>)[k] = v;
      }
      return Promise.resolve({ ...u });
    }),
  },
  // Array form: the operations already ran when the array was built (in order).
  $transaction: vi.fn((arg: unknown) => (Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(db))),
  $disconnect: vi.fn(() => Promise.resolve()),
};

export const dbModule = { db };

export const resetDb = {
  db,
  tokens,
  users,
  reset(): void {
    tokens.clear();
    users.clear();
  },
  addUser(u: Partial<FakeUser> & { id: string; email: string }): FakeUser {
    const row: FakeUser = {
      name: null,
      role: "contributor",
      isActive: true,
      organizationId: "org-1",
      passwordHash: "old-hash",
      tokenVersion: 1,
      ...u,
    };
    users.set(row.id, row);
    return row;
  },
};
