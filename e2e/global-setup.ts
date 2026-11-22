import { rmSync } from "node:fs";
import path from "node:path";
import { STATE_DIR, up } from "./stack";

// Builds the app image from this checkout and starts a fresh e2e stack
// (app + Postgres + Redis + Mailpit + webhook receiver), then records the
// first-run setup code from `docker compose logs app` in e2e/.state/stack.json.
// With E2E_EXTERNAL_STACK=1 the running stack and the run state left by the
// previous specs are reused (handy for re-running one spec while debugging).
export default async function globalSetup(): Promise<void> {
  if (process.env.E2E_EXTERNAL_STACK === "1") return;
  // Per-run state shared between specs (ids, users); a new stack starts empty.
  rmSync(path.join(STATE_DIR, "run.json"), { force: true });
  up();
}
