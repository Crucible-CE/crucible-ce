// Integration-test helpers for incident features (guest links, status pages,
// broadcasts, playbook runs). Same rules as src/test/exercise-db.ts: only with
// TEST_DATABASE_URL, a database whose name ends in _test.

import { ensureTestOrg } from "@/test/exercise-db";

export type CeRole = "reader" | "contributor" | "administrator";

export interface TestMember {
  id: string;
  name: string;
  email: string;
  role: CeRole;
  organizationId: string;
}

let n = 0;
const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function createMember(role: CeRole, name = `${role} ${uniq()}`): Promise<TestMember> {
  const organizationId = await ensureTestOrg();
  const { db } = await import("@/lib/db");
  const u = await db.user.create({ data: { email: `${uniq()}@example.test`, name, role, organizationId }, select: { id: true, name: true, email: true } });
  return { id: u.id, name: u.name ?? name, email: u.email, role, organizationId };
}

/** The Auth.js session of a member, for tests that mock auth(). */
export function memberSession(m: TestMember) {
  return { user: { id: m.id, name: m.name, email: m.email, organizationId: m.organizationId, role: m.role }, expires: "2999-01-01" };
}

export async function createIncident(reporter: TestMember, data: { title?: string; category?: string; description?: string; restricted?: boolean; mitre?: string[] } = {}) {
  const { db } = await import("@/lib/db");
  return db.incident.create({
    data: {
      organizationId: reporter.organizationId,
      reportedById: reporter.id,
      title: data.title ?? `Incident ${uniq()}`,
      description: data.description ?? "Test incident.",
      category: data.category ?? null,
      restricted: data.restricted ?? false,
      lockedAt: data.restricted ? new Date() : null,
      mitreJson: data.mitre ?? undefined,
    },
    select: { id: true, title: true },
  });
}

export function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
