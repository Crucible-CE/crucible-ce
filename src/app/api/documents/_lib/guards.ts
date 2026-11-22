// Shared guards for the document routes. Every signed-in user may read
// documents; documents.manage may write. Template routes need templates.manage.

import { NextResponse } from "next/server";
import { requirePermission, requireUser, type GuardResult } from "@/lib/exercise/auth/session";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { canReadTemplateSecrets } from "@/lib/exercise/access";

export const PLAYING_THIS_TEMPLATE = "You are playing in an exercise that uses this template.";

/**
 * 403 when the caller holds a non-control seat in a lobby, live or paused
 * exercise that runs this template. Null when allowed.
 */
export async function templateSecretsGuard(userId: string, templateId: string): Promise<NextResponse | null> {
  if (await canReadTemplateSecrets(userId, templateId)) return null;
  return NextResponse.json({ error: PLAYING_THIS_TEMPLATE }, { status: 403 });
}

export const DOC_NOT_FOUND = { error: "Document not found." } as const;
export const TEMPLATE_NOT_FOUND = { error: "Template not found." } as const;

export const requireDocumentReader = (): Promise<GuardResult> => requireUser();
export const requireDocumentManager = (): Promise<GuardResult> => requirePermission("documents.manage");
export const requireTemplateManager = (): Promise<GuardResult> => requirePermission("templates.manage");

/** Per-user hourly limit. Returns a 429 response when refused. */
export async function hourlyLimit(userId: string, namespace: string, max: number): Promise<NextResponse | null> {
  const r = await checkRateLimit({ namespace, identifier: userId, windowMs: 60 * 60_000, max });
  if (r.allowed) return null;
  return NextResponse.json(
    { error: "Too many requests. Try again later." },
    { status: 429, headers: { "Retry-After": String(Math.max(1, r.retryAfter)) } },
  );
}
