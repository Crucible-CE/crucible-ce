// Shared helpers for the template routes. Secret columns are only ever served
// to callers holding templates.manage (facilitators and admins).

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/exercise/auth/rbac";
import { requirePermission, requireUser, FORBIDDEN_BODY, type GuardResult } from "@/lib/exercise/auth/session";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { canReadTemplateSecrets } from "@/lib/exercise/access";
import {
  expectedActionsSchema,
  templateConfigSchema,
  templateInjectContentSchema,
  templateInjectSecretSchema,
  templateObjectivesSchema,
} from "@/lib/exercise/modes/crisissim/schema";

export const TEMPLATE_STATUSES = ["draft", "published", "archived"] as const;

/** Drop the generation bookkeeping that templates imported from older installs may carry. */
export function configWithoutGeneration(config: unknown): Record<string, unknown> {
  const { generation: _g, ...rest } = (config ?? {}) as Record<string, unknown>;
  return rest;
}
export const NOT_FOUND = { error: "Template not found." } as const;

export function requireTemplateManager(): Promise<GuardResult> {
  return requirePermission("templates.manage");
}

/** Signed in and allowed to manage templates or create exercises. */
export async function requireTemplateReader(): Promise<GuardResult> {
  const a = await requireUser();
  if (!a.ok) return a;
  if (!hasPermission(a.user, "templates.manage") && !hasPermission(a.user, "exercises.create")) {
    return { ok: false, response: NextResponse.json(FORBIDDEN_BODY, { status: 403 }) };
  }
  return a;
}

/** Per-user hourly limit on template writes. */
export async function hourlyRateLimit(userId: string, namespace: string, max: number): Promise<NextResponse | null> {
  const r = await checkRateLimit({ namespace, identifier: userId, windowMs: 60 * 60_000, max });
  if (r.allowed) return null;
  return NextResponse.json(
    { error: "Too many requests. Try again later." },
    { status: 429, headers: { "Retry-After": String(Math.max(1, r.retryAfter)) } },
  );
}

const ACTIVE_EXERCISE = ["draft", "lobby", "live", "paused"];

/**
 * 403 when the caller holds a non-control seat in a lobby, live or paused
 * exercise that runs this template, so a player cannot read the hidden
 * quality, rationales or expected actions ahead of play. Null when allowed.
 */
export async function secretsGuard(userId: string, templateId: string): Promise<NextResponse | null> {
  if (await canReadTemplateSecrets(userId, templateId)) return null;
  return NextResponse.json(
    { error: "You are playing in an exercise that uses this template. Its content is hidden until that exercise ends." },
    { status: 403 },
  );
}

/** True when an exercise that has not ended still reads this template. */
export async function templateInUse(templateId: string): Promise<boolean> {
  const n = await db.exercise.count({ where: { templateId, status: { in: ACTIVE_EXERCISE } } });
  return n > 0;
}

export async function loadTemplate(id: string) {
  return db.exerciseTemplate.findUnique({
    where: { id },
    include: { injects: { orderBy: { seq: "asc" } } },
  });
}

type Loaded = NonNullable<Awaited<ReturnType<typeof loadTemplate>>>;

export function serializeTemplate(t: Loaded) {
  return {
    template: {
      id: t.id,
      mode: t.mode,
      title: t.title,
      summary: t.summary,
      scope: t.scope,
      status: t.status,
      version: t.version,
      branching: t.branching,
      sourceId: t.sourceId,
      config: configWithoutGeneration(t.config),
      objectives: t.objectives,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    },
    injects: t.injects.map((i) => ({
      id: i.id,
      nodeId: i.nodeId,
      seq: i.seq,
      title: i.title,
      scenarioOffsetMin: i.scenarioOffsetMin,
      plannedDelayMin: i.plannedDelayMin,
      targetTeams: i.targetTeams,
      objectiveKeys: i.objectiveKeys,
      expectedActions: i.expectedActions,
      content: i.content,
      secret: i.secret,
      position: i.position,
    })),
  };
}

// ---------------------------------------------------------------------------
// Crisis Sim edit schemas
// ---------------------------------------------------------------------------

export const crisisSimInjectEditSchema = z.object({
  id: z.string().max(40).optional(),
  nodeId: z.string().max(40).optional(),
  title: z.string().trim().min(1, "Every inject needs a title.").max(160),
  scenarioOffsetMin: z.number().int().min(0).max(60 * 24 * 365),
  plannedDelayMin: z.number().int().min(1).max(120).nullable(),
  targetTeams: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  objectiveKeys: z.array(z.string().max(40)).max(12).default([]),
  expectedActions: expectedActionsSchema,
  content: templateInjectContentSchema,
  secret: templateInjectSecretSchema,
});

export const crisisSimTemplateBodySchema = z.object({
  title: z.string().trim().min(3, "Enter a title.").max(160),
  summary: z.string().trim().max(800).nullable().optional(),
  config: templateConfigSchema,
  objectives: templateObjectivesSchema.default([]),
  injects: z.array(crisisSimInjectEditSchema).min(1).max(30),
});

// ---------------------------------------------------------------------------
// Export format
// ---------------------------------------------------------------------------
