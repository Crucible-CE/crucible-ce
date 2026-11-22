// Exercise list for /exercises and GET /api/exercises.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/exercise/auth/rbac";
import type { SessionUser } from "@/lib/exercise/auth/session";
import { MODE_LABELS } from "@/lib/exercise/modes/registry";
import type { Mode } from "@/lib/exercise/runtime/types";

export const LIST_TABS = {
  live: ["live", "paused"],
  planned: ["draft", "lobby"],
  ended: ["ended", "abandoned"],
} as const;
export type ListTab = keyof typeof LIST_TABS;

export function isListTab(v: unknown): v is ListTab {
  return typeof v === "string" && v in LIST_TABS;
}

export interface ExerciseListItem {
  id: string;
  title: string;
  mode: string;
  modeLabel: string;
  status: string;
  isPractice: boolean;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  endReason: string | null;
  teamCount: number;
  participantCount: number;
  myRoles: string[];
}

/** Exercises the user may see, newest first. Facilitators and admins see all. */
export async function listExercises(user: SessionUser, opts: { statuses?: readonly string[]; take?: number } = {}): Promise<ExerciseListItem[]> {
  const where: Prisma.ExerciseWhereInput = {};
  if (opts.statuses?.length) where.status = { in: [...opts.statuses] };
  if (!hasPermission(user, "exercises.view_all")) {
    where.OR = [{ createdById: user.id }, { participants: { some: { userId: user.id, removedAt: null } } }];
  }
  const rows = await db.exercise.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    take: opts.take ?? 200,
    select: {
      id: true,
      title: true,
      mode: true,
      status: true,
      isPractice: true,
      createdAt: true,
      startedAt: true,
      endedAt: true,
      endReason: true,
      _count: { select: { teams: true, participants: { where: { removedAt: null } } } },
      participants: { where: { userId: user.id, removedAt: null }, select: { roles: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    mode: r.mode,
    modeLabel: MODE_LABELS[r.mode as Mode] ?? r.mode,
    status: r.status,
    isPractice: r.isPractice,
    createdAt: r.createdAt,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    endReason: r.endReason,
    teamCount: r._count.teams,
    participantCount: r._count.participants,
    myRoles: r.participants[0]?.roles ?? [],
  }));
}
