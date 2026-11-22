// Job handler registry for exercise work. Feature modules add their handlers
// through registerRuntimeJob() at import time; boot calls registerRuntimeJobs()
// once to hand them to the worker.

import { registerJobHandler } from "./queue";

type Handler = (payload: Record<string, unknown>) => Promise<void>;

const KEY = Symbol.for("crucible.ce.exercise.runtimeJobs");

function registry(): Map<string, Handler> {
  const g = globalThis as typeof globalThis & { [KEY]?: Map<string, Handler> };
  if (!g[KEY]) g[KEY] = new Map();
  return g[KEY];
}

/** @public */
export function registerRuntimeJob(kind: string, handler: Handler): void {
  registry().set(kind, handler);
}

export async function registerRuntimeJobs(): Promise<void> {
  // Feature handler modules. Each calls registerRuntimeJob() when imported.
  await import("./handler-modules");
  for (const [kind, handler] of registry()) {
    registerJobHandler(kind, async (payload) => handler((payload ?? {}) as Record<string, unknown>));
  }
}
