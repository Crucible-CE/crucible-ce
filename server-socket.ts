// ---------------------------------------------------------------------------
// Dev-only Socket.io + cron sidecar.
//
// Why this exists:
//   `npm run dev` (next dev --turbopack) runs Next.js with Turbopack and
//   skips the custom server entirely — meaning Socket.io + the node-cron jobs
//   would never start. Booting the full `server.ts` instead gets the socket
//   bus back but pulls Next.js into webpack-dev mode (the programmatic
//   `next()` API doesn't take the `--turbopack` flag), and dev compile times
//   explode.
//
//   Split: keep `next dev --turbopack` on :3000 and run THIS file on :3001 for
//   Socket.io + the crons. `dev:full` runs both concurrently. The browser
//   already probes :3001 first (see NEXT_PUBLIC_SOCKET_URL in .env and the
//   candidate-URL list in src/lib/socket/client.ts), so no client changes are
//   needed.
//
//   Production stays on `server.ts` — single process, single port. This file
//   is dev-only.
// ---------------------------------------------------------------------------

import "./load-env"; // MUST be first — loads .env.local before Prisma/db import
import { createServer } from "http";
import cron from "node-cron";
import { initSocketServer } from "./src/lib/socket/server";
import { withCronLock } from "./src/lib/security/cron-lock";
import { escalateOverduePages } from "./src/lib/escalation/engine";
import { processDeliveryRetries } from "./src/lib/delivery/engine";
import { ensurePluginsLoaded } from "./src/lib/delivery/registry";
import { flushDigests } from "./src/lib/notifications/digest";
import { formatSecretProblems, validateBootSecrets } from "./src/lib/boot/secrets";
import { bootRuntime } from "./src/lib/exercise/runtime/boot";
import { registerInfraCrons } from "./src/lib/exercise/runtime/infra-crons";
import { startCrons as startExerciseCrons } from "./src/lib/exercise/runtime/cron";
import { startJobWorker } from "./src/lib/exercise/runtime/jobs/worker";

const PORT = parseInt(process.env.SOCKET_PORT ?? "3001", 10);

async function main() {
  // Same boot-time secret gate as server.ts: this sidecar verifies session
  // JWTs, so it must not run on a placeholder secret either.
  const secretProblems = validateBootSecrets(process.env);
  if (secretProblems.length > 0) {
    console.error(formatSecretProblems(secretProblems).replace("[server]", "[ws]"));
    process.exit(1);
  }

  // Bare HTTP server — Socket.io will register its own request listener for
  // /socket.io paths. Any other request gets a small "this is the socket
  // sidecar, the app lives on :3000" hint so a stray hit is debuggable.
  const httpServer = createServer((req, res) => {
    if (req.url && req.url.startsWith("/socket.io")) return;
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, sidecar: true }));
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end(
      `Crucible CE socket sidecar on :${PORT}. The Next.js app runs on :3000.\n`,
    );
  });

  await initSocketServer(httpServer);

  const plugins = await ensurePluginsLoaded();
  console.log(`[ws] delivery plugins: ${plugins.loaded.length} loaded, ${plugins.errors.length} skipped (${plugins.dir})`);

  // -------------------------------------------------------------------------
  // Cron: paging ack-timeout escalation — every minute (dev parity with
  // server.ts; withCronLock("page-escalation") keeps overlap single-flight).
  // -------------------------------------------------------------------------
  cron.schedule("* * * * *", async () => {
    await withCronLock("page-escalation", 55, async () => {
      try {
        const { escalated, expired, cancelled } = await escalateOverduePages();
        if (escalated || expired || cancelled) {
          console.log(`[cron] page escalation: ${escalated} escalated, ${expired} expired, ${cancelled} cancelled (incident closed)`);
        }
      } catch (error) {
        console.error("[cron] page-escalation error:", error);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Cron: out-of-band delivery retries — every minute. Failed page/escalation
  // deliveries retry on backoff (default 1m, 5m, 15m). Each due row is claimed
  // by a guarded update, so overlapping runners never double-send.
  // -------------------------------------------------------------------------
  cron.schedule("* * * * *", async () => {
    await withCronLock("page-delivery-retry", 55, async () => {
      try {
        const { retried, abandoned } = await processDeliveryRetries();
        if (retried || abandoned) {
          console.log(`[cron] delivery retries: ${retried} retried, ${abandoned} abandoned (page no longer open)`);
        }
      } catch (error) {
        console.error("[cron] page-delivery-retry error:", error);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Cron: notification digest flush — every 5 minutes (dev parity).
  // -------------------------------------------------------------------------
  cron.schedule("*/5 * * * *", async () => {
    await withCronLock("notifications-flush", 280, async () => {
      try {
        await flushDigests();
      } catch (error) {
        console.error("[cron] Notifications-flush error:", error);
      }
    });
  });

  // Exercises: room authorizer, exercise crons, job worker, inject timers.
  registerInfraCrons();
  await bootRuntime();
  const exerciseCronCount = startExerciseCrons();
  startJobWorker();
  console.log(`[ws] exercises: ${exerciseCronCount} cron job${exerciseCronCount === 1 ? "" : "s"} registered; job worker running`);

  httpServer.listen(PORT, () => {
    console.log(`> Crucible CE socket sidecar ready on http://localhost:${PORT}`);
  });
}

void main();
