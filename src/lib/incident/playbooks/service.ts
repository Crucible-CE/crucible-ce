// Incident playbook runs: attach a playbook document from Documents to an
// incident, run it as a checklist, check steps off (who and when), edit the
// checklist for this incident, and turn a step into an incident task. The
// document is never changed. Every attach, removal and check-off is on the
// incident ledger.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { appendLedger } from "@/lib/ledger/append";
import { parseChecklist } from "./checklist";

export interface RunActor {
  id: string;
  name: string | null;
}

export class PlaybookRunError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
  }
}

const STEP_SELECT = {
  id: true,
  position: true,
  section: true,
  text: true,
  detail: true,
  kind: true,
  source: true,
  doneAt: true,
  doneByName: true,
  taskId: true,
} as const;

export type RunStepView = Prisma.IncidentPlaybookStepGetPayload<{ select: typeof STEP_SELECT }>;

export interface RunView {
  id: string;
  documentId: string | null;
  documentTitle: string;
  libraryKey: string | null;
  status: string;
  createdByName: string | null;
  createdAt: Date;
  completedAt: Date | null;
  steps: RunStepView[];
  doneCount: number;
  totalCount: number;
}

/** Progress of a run (pure). */
export function runProgress(steps: { doneAt: Date | null }[]): { done: number; total: number; percent: number } {
  const done = steps.filter((s) => s.doneAt).length;
  return { done, total: steps.length, percent: steps.length ? Math.round((done / steps.length) * 100) : 0 };
}

export async function listRuns(incidentId: string): Promise<RunView[]> {
  const runs = await db.incidentPlaybookRun.findMany({
    where: { incidentId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      documentId: true,
      documentTitle: true,
      libraryKey: true,
      status: true,
      createdByName: true,
      createdAt: true,
      completedAt: true,
      steps: { orderBy: { position: "asc" }, select: STEP_SELECT },
    },
  });
  return runs.map((r) => {
    const p = runProgress(r.steps);
    return { ...r, doneCount: p.done, totalCount: p.total };
  });
}

/** Attach a playbook document to an incident: copy its checklist into a new run. */
export async function attachPlaybook(args: { incidentId: string; organizationId: string; documentId: string; actor: RunActor }): Promise<string> {
  const doc = await db.sourceDocument.findFirst({
    where: { id: args.documentId, organizationId: args.organizationId, kind: "playbook" },
    select: { id: true, title: true, text: true, sha256: true, libraryKey: true },
  });
  if (!doc) throw new PlaybookRunError("Playbook not found.", 404);
  const already = await db.incidentPlaybookRun.findFirst({ where: { incidentId: args.incidentId, documentId: doc.id }, select: { id: true } });
  if (already) throw new PlaybookRunError("This playbook is already attached.", 409);

  const sections = parseChecklist(doc.text);
  let position = 0;
  const steps = sections.flatMap((s) =>
    s.steps.map((st) => ({ section: s.heading, text: st.text, detail: st.detail, kind: st.kind, position: (position += 10) })),
  );

  return db.$transaction(async (tx) => {
    const run = await tx.incidentPlaybookRun.create({
      data: {
        organizationId: args.organizationId,
        incidentId: args.incidentId,
        documentId: doc.id,
        documentTitle: doc.title,
        documentSha256: doc.sha256,
        libraryKey: doc.libraryKey,
        createdById: args.actor.id,
        createdByName: args.actor.name,
      },
      select: { id: true },
    });
    if (steps.length) {
      await tx.incidentPlaybookStep.createMany({
        data: steps.map((s) => ({ ...s, organizationId: args.organizationId, incidentId: args.incidentId, runId: run.id, source: "document" })),
      });
    }
    await appendLedger(tx, {
      incidentId: args.incidentId,
      organizationId: args.organizationId,
      eventType: "playbook_attached",
      actorUserId: args.actor.id,
      actorLabel: args.actor.name,
      payload: { runId: run.id, documentId: doc.id, title: doc.title, sha256: doc.sha256, steps: steps.length },
    });
    return run.id;
  });
}

async function loadRun(incidentId: string, runId: string) {
  const run = await db.incidentPlaybookRun.findFirst({ where: { id: runId, incidentId }, select: { id: true, organizationId: true, documentTitle: true, status: true } });
  if (!run) throw new PlaybookRunError("Not found.", 404);
  return run;
}

async function loadStep(incidentId: string, runId: string, stepId: string) {
  const step = await db.incidentPlaybookStep.findFirst({
    where: { id: stepId, runId, incidentId },
    select: { id: true, text: true, detail: true, section: true, position: true, doneAt: true, taskId: true, run: { select: { documentTitle: true, organizationId: true } } },
  });
  if (!step) throw new PlaybookRunError("Not found.", 404);
  return step;
}

/** Keep the run's status in step with its checklist: completed when every step is done. */
async function syncRunStatus(tx: Prisma.TransactionClient, runId: string, now: Date): Promise<void> {
  const [total, open] = await Promise.all([
    tx.incidentPlaybookStep.count({ where: { runId } }),
    tx.incidentPlaybookStep.count({ where: { runId, doneAt: null } }),
  ]);
  const complete = total > 0 && open === 0;
  await tx.incidentPlaybookRun.updateMany({
    where: { id: runId, status: complete ? "active" : "completed" },
    data: complete ? { status: "completed", completedAt: now } : { status: "active", completedAt: null },
  });
}

export async function removeRun(args: { incidentId: string; runId: string; actor: RunActor }): Promise<void> {
  const run = await loadRun(args.incidentId, args.runId);
  await db.$transaction(async (tx) => {
    await tx.incidentPlaybookRun.delete({ where: { id: run.id } });
    await appendLedger(tx, {
      incidentId: args.incidentId,
      organizationId: run.organizationId,
      eventType: "playbook_removed",
      actorUserId: args.actor.id,
      actorLabel: args.actor.name,
      payload: { runId: run.id, title: run.documentTitle },
    });
  });
}

/** Check a step off (done) or reopen it. Guarded, so a double click records once. */
export async function setStepDone(args: { incidentId: string; runId: string; stepId: string; done: boolean; actor: RunActor; now?: Date }): Promise<void> {
  const step = await loadStep(args.incidentId, args.runId, args.stepId);
  const now = args.now ?? new Date();
  await db.$transaction(async (tx) => {
    const { count } = await tx.incidentPlaybookStep.updateMany({
      where: { id: step.id, doneAt: args.done ? null : { not: null } },
      data: args.done ? { doneAt: now, doneById: args.actor.id, doneByName: args.actor.name } : { doneAt: null, doneById: null, doneByName: null },
    });
    if (count === 0) return;
    await appendLedger(tx, {
      incidentId: args.incidentId,
      organizationId: step.run.organizationId,
      eventType: args.done ? "playbook_step_done" : "playbook_step_reopened",
      actorUserId: args.actor.id,
      actorLabel: args.actor.name,
      payload: { runId: args.runId, stepId: step.id, step: step.text, title: step.run.documentTitle },
    });
    await syncRunStatus(tx, args.runId, now);
  });
}

export async function editStep(args: { incidentId: string; runId: string; stepId: string; text?: string; detail?: string | null; move?: "up" | "down" }): Promise<void> {
  const step = await loadStep(args.incidentId, args.runId, args.stepId);
  if (args.text !== undefined || args.detail !== undefined) {
    await db.incidentPlaybookStep.update({
      where: { id: step.id },
      data: { ...(args.text !== undefined ? { text: args.text } : {}), ...(args.detail !== undefined ? { detail: args.detail } : {}) },
    });
  }
  if (args.move) {
    const neighbor = await db.incidentPlaybookStep.findFirst({
      where: { runId: args.runId, position: args.move === "up" ? { lt: step.position } : { gt: step.position } },
      orderBy: { position: args.move === "up" ? "desc" : "asc" },
      select: { id: true, position: true, section: true },
    });
    if (!neighbor) return;
    // Moving across a section boundary moves the step into that section.
    await db.$transaction([
      db.incidentPlaybookStep.update({ where: { id: step.id }, data: { position: neighbor.position, section: neighbor.section } }),
      db.incidentPlaybookStep.update({ where: { id: neighbor.id }, data: { position: step.position } }),
    ]);
  }
}

/** Add a step at the end of a section (or a new section at the end of the run). */
export async function addStep(args: { incidentId: string; runId: string; section: string; text: string }): Promise<string> {
  const run = await loadRun(args.incidentId, args.runId);
  return db.$transaction(async (tx) => {
    const last = await tx.incidentPlaybookStep.findFirst({ where: { runId: run.id, section: args.section }, orderBy: { position: "desc" }, select: { position: true } });
    let position: number;
    if (last) {
      // Make room right after the section's last step.
      await tx.incidentPlaybookStep.updateMany({ where: { runId: run.id, position: { gt: last.position } }, data: { position: { increment: 10 } } });
      position = last.position + 10;
    } else {
      const end = await tx.incidentPlaybookStep.findFirst({ where: { runId: run.id }, orderBy: { position: "desc" }, select: { position: true } });
      position = (end?.position ?? 0) + 10;
    }
    const step = await tx.incidentPlaybookStep.create({
      data: { organizationId: run.organizationId, incidentId: args.incidentId, runId: run.id, position, section: args.section, text: args.text, source: "custom" },
      select: { id: true },
    });
    await syncRunStatus(tx, run.id, new Date());
    return step.id;
  });
}

export async function deleteStep(args: { incidentId: string; runId: string; stepId: string }): Promise<void> {
  const step = await loadStep(args.incidentId, args.runId, args.stepId);
  await db.$transaction(async (tx) => {
    await tx.incidentPlaybookStep.delete({ where: { id: step.id } });
    await syncRunStatus(tx, args.runId, new Date());
  });
}

/** Make an incident task from a step (once) and link it to the step. */
export async function stepToTask(args: { incidentId: string; runId: string; stepId: string; actor: RunActor }): Promise<string> {
  const step = await loadStep(args.incidentId, args.runId, args.stepId);
  if (step.taskId) throw new PlaybookRunError("This step already has a task.", 409);
  return db.$transaction(async (tx) => {
    const task = await tx.incidentTask.create({
      data: {
        organizationId: step.run.organizationId,
        incidentId: args.incidentId,
        title: step.text.slice(0, 200),
        description: [step.detail, `From the playbook ${step.run.documentTitle}, ${step.section}.`].filter(Boolean).join("\n\n").slice(0, 5000),
      },
      select: { id: true, title: true },
    });
    const { count } = await tx.incidentPlaybookStep.updateMany({ where: { id: step.id, taskId: null }, data: { taskId: task.id } });
    if (count === 0) throw new PlaybookRunError("This step already has a task.", 409);
    await appendLedger(tx, {
      incidentId: args.incidentId,
      organizationId: step.run.organizationId,
      eventType: "task_updated",
      actorUserId: args.actor.id,
      actorLabel: args.actor.name,
      payload: { taskId: task.id, title: task.title, kind: "created", fromPlaybookStep: step.id },
    });
    return task.id;
  });
}
