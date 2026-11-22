// Integration-test helpers for exercises. Integration tests (*.int.test.ts)
// run only when TEST_DATABASE_URL is set (vitest.config.ts points
// DATABASE_URL at it) and never touch the dev database. The database name
// must end in _test.
//
//   TEST_DATABASE_URL=postgresql://u:p@127.0.0.1:5432/ce_test npx vitest run src/lib/exercise
//
//   describe.skipIf(!hasTestDb)("...", () => { ... });

import type { SessionUser } from "@/lib/exercise/auth/session";

export const hasTestDb = !!process.env.TEST_DATABASE_URL && process.env.DATABASE_URL === process.env.TEST_DATABASE_URL;

/** The organization every test row belongs to. */
export const TEST_ORG_ID = "org-exercise-test";

/** Older test files name these tables; CE keeps audit rows in AdminAuditLog and rate limits in Redis. */
const TABLE_ALIASES: Record<string, string | null> = { AuditEvent: "AdminAuditLog", RateLimitBucket: null };

function assertTestDb(): void {
  if (!hasTestDb) throw new Error("needs TEST_DATABASE_URL");
  const name = new URL(process.env.DATABASE_URL ?? "postgresql://x/x").pathname.replace(/^\//, "");
  if (!/_test$/.test(name)) throw new Error("refusing to write to a database whose name does not end in _test");
}

/** The test organization, created when missing. */
export async function ensureTestOrg(): Promise<string> {
  assertTestDb();
  const { db } = await import("@/lib/db");
  await db.organization.upsert({ where: { id: TEST_ORG_ID }, create: { id: TEST_ORG_ID, name: "Exercise test org", slug: TEST_ORG_ID }, update: {} });
  return TEST_ORG_ID;
}

/** Delete every row of the named tables (quoted Prisma model names), then make sure the test organization exists. */
export async function truncate(...tables: string[]): Promise<void> {
  assertTestDb();
  const { db } = await import("@/lib/db");
  const names = tables.map((t) => (t in TABLE_ALIASES ? TABLE_ALIASES[t] : t)).filter((t): t is string => Boolean(t));
  const list = [...new Set(names)].map((t) => `"${t.replace(/"/g, "")}"`).join(", ");
  if (list) await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  if (tables.includes("RateLimitBucket")) await resetRateLimits();
  await ensureTestOrg();
}

/** Drop every rate limit window in Redis (when REDIS_URL is set). */
export async function resetRateLimits(): Promise<void> {
  const { getRedis, rkey } = await import("@/lib/db/redis");
  const client = await getRedis();
  if (!client) return;
  const keys: string[] = [];
  for await (const batch of client.scanIterator({ MATCH: rkey("rl:*"), COUNT: 500 })) keys.push(...(Array.isArray(batch) ? batch : [batch]));
  if (keys.length) await client.del(keys);
}

const CE_ROLE: Record<SessionUser["role"], string> = { admin: "administrator", director: "exercise_director", facilitator: "contributor", member: "reader" };

/** A CE user in the test organization, returned as the exercise session user. */
export async function createTestUser(input: { email: string; name: string; role: SessionUser["role"] | string }): Promise<SessionUser> {
  const organizationId = await ensureTestOrg();
  const { db } = await import("@/lib/db");
  const role = (input.role in CE_ROLE ? input.role : "facilitator") as SessionUser["role"];
  const u = await db.user.create({
    data: { email: input.email, name: input.name, role: CE_ROLE[role], organizationId },
    select: { id: true, name: true, email: true },
  });
  return { id: u.id, name: u.name ?? "", email: u.email, role, organizationId };
}

/** The CE Auth.js session for a test user, for tests that mock auth(). */
export function sessionFor(u: SessionUser) {
  return { user: { id: u.id, name: u.name, email: u.email, organizationId: u.organizationId, role: CE_ROLE[u.role] }, expires: "2999-01-01" };
}

/** Set exercise settings for the test organization (time zone, policy, sponsor sign-off, Cloud notes). */
export async function setTestSettings(data: { timezone?: string; policy?: object; requireSponsorSignoff?: boolean; enabledFrameworks?: string[]; showCloudNotes?: boolean } = {}): Promise<void> {
  const organizationId = await ensureTestOrg();
  const { db } = await import("@/lib/db");
  const { __resetInstallOrgForTests } = await import("@/lib/exercise/settings");
  __resetInstallOrgForTests();
  await db.exerciseSettings.upsert({ where: { organizationId }, create: { organizationId, ...data }, update: data });
}
