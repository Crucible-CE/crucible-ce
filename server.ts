import { createServer } from "http";
import next from "next";
import cron from "node-cron";
import { initSocketServer } from "./src/lib/socket/server";
import { db } from "./src/lib/db";
import { withCronLock } from "./src/lib/security/cron-lock";
import { flushDigests } from "./src/lib/notifications/digest";
import { assertKmsProviderConfigured } from "./src/lib/crypto/kms";
import { escalateOverduePages } from "./src/lib/escalation/engine";
import { processDeliveryRetries } from "./src/lib/delivery/engine";
import { ensurePluginsLoaded } from "./src/lib/delivery/registry";
import { webhookBootWarnings } from "./src/lib/delivery/providers/webhook";
import { formatSecretProblems, validateBootSecrets } from "./src/lib/boot/secrets";
import { ensureSetupCode } from "./src/lib/setup/setup-code";
import { createPeerIpStamper } from "./src/lib/security/peer-ip";
import { TRUSTED_PROXY_HOPS } from "./src/lib/security/client-ip";
import { describeCsrfAllowedOrigins } from "./src/lib/security/csrf";
import { signingKeyProblem } from "./src/lib/export/signing";
import { CONTACT_VERIFY_STALE_DAYS, staleContactWhere } from "./src/lib/escalation/contact-fields";
import { bootRuntime } from "./src/lib/exercise/runtime/boot";
import { registerInfraCrons } from "./src/lib/exercise/runtime/infra-crons";
import { startCrons as startExerciseCrons, stopCrons as stopExerciseCrons } from "./src/lib/exercise/runtime/cron";
import { startJobWorker, stopJobWorker } from "./src/lib/exercise/runtime/jobs/worker";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT ?? "3000", 10);

// Refuse to serve with placeholder / weak secrets (NEXTAUTH_SECRET, AUTH_SECRET,
// MASTER_KEK). Boot-only on purpose: `next build` and CI never run this file,
// so their throwaway build values keep working. See src/lib/boot/secrets.ts.
const secretProblems = validateBootSecrets(process.env);
if (secretProblems.length > 0) {
  console.error(formatSecretProblems(secretProblems));
  process.exit(1);
}

const app = next({ dev });
const handle = app.getRequestHandler();

// The real TCP peer address, handed to route handlers under a header NAME that
// is random per process: a client can't forge a header it can't name. With
// TRUSTED_PROXY_HOPS=0 (CE default, no proxy) rate limits key on this instead
// of collapsing every client into one shared "unknown" bucket. The stamper also
// warns once if X-Forwarded-For shows up while TRUSTED_PROXY_HOPS=0 (a proxy
// the app was not told about). See src/lib/security/peer-ip.ts + client-ip.ts.
const peerIp = createPeerIpStamper({ trustedProxyHops: TRUSTED_PROXY_HOPS });

app.prepare().then(async () => {
  const httpServer = createServer((req, res) => {
    // Socket.io polling requests must not reach Next.js — Socket.io registers
    // its own `request` listener on this server and handles them directly.
    // Passing them through Next.js first causes 404s before Socket.io runs.
    if (req.url && req.url.startsWith("/socket.io")) return;
    peerIp.stamp(req);
    handle(req, res);
  });
  const io = await initSocketServer(httpServer);

  // Crons run in this (the only) process. withCronLock keeps each body
  // single-flight if a run overlaps the next tick.
  let registeredCronCount = 0;
  const schedule = (expression: string, task: () => void | Promise<void>) => {
    cron.schedule(expression, task);
    registeredCronCount += 1;
  };

  // -----------------------------------------------------------------------
  // Cron: paging ack-timeout escalation — every minute.
  // THE core out-of-band promise: a page that is not acknowledged inside its
  // ack window escalates up the chain (tech lead -> IC -> exec sponsor) and
  // eventually expires. withCronLock("page-escalation") keeps any overlap
  // single-flight (same key as server-socket.ts, if both processes run crons).
  // -----------------------------------------------------------------------
  schedule("* * * * *", async () => {
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

  // -----------------------------------------------------------------------
  // Cron: out-of-band delivery retries — every minute. Sweeps rows stuck in
  // "pending" (crash mid-send), re-fans-out open pages whose current level was
  // never delivered (crash before deliverPage), then retries failed attempts
  // on backoff (default 1m, 5m, 15m) and rate-limited skips once their window
  // frees. The next attempt's unique key is the claim: no double-send.
  // -----------------------------------------------------------------------
  schedule("* * * * *", async () => {
    await withCronLock("page-delivery-retry", 55, async () => {
      try {
        const { retried, abandoned, swept, refanned } = await processDeliveryRetries();
        if (retried || abandoned || swept || refanned) {
          console.log(
            `[cron] delivery retries: ${retried} retried, ${abandoned} abandoned (page no longer open), ` +
              `${swept} stale pending swept, ${refanned} undelivered page(s) re-fanned out`,
          );
        }
      } catch (error) {
        console.error("[cron] page-delivery-retry error:", error);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Cron: notification digest flush — every 5 minutes.
  // -----------------------------------------------------------------------
  schedule("*/5 * * * *", async () => {
    await withCronLock("notifications-flush", 280, async () => {
      try {
        await flushDigests();
      } catch (error) {
        console.error("[cron] Notifications-flush error:", error);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Cron: Escalation-contact verification nudge — Mondays at 08:30 UTC.
  // Contacts unverified for > 90 days (or never) are stale. Per org with
  // stale contacts: notify admins (once per day max) to re-verify the matrix.
  // A wrong number costs the most exactly when the matrix is needed.
  // -----------------------------------------------------------------------
  schedule("30 8 * * 1", async () => {
    await withCronLock("escalation-verification-nudge", 3500, async () => {
      try {
        const now = new Date();
        const staleBefore = new Date(now.getTime() - CONTACT_VERIFY_STALE_DAYS * 24 * 60 * 60_000);

        // Email and phone are verified separately: either one unverified or
        // stale makes the contact stale.
        const staleContacts = await db.escalationContact.findMany({
          where: staleContactWhere(staleBefore),
          select: { organizationId: true },
        });

        const staleByOrg = new Map<string, number>();
        for (const c of staleContacts) {
          staleByOrg.set(c.organizationId, (staleByOrg.get(c.organizationId) ?? 0) + 1);
        }

        for (const [orgId, staleCount] of staleByOrg) {
          try {
            const admins = await db.user.findMany({
              where: { organizationId: orgId, role: "administrator", isActive: true },
              select: { id: true },
            });

            for (const admin of admins) {
              const existingToday = await db.notification.findFirst({
                where: {
                  userId: admin.id,
                  link: "/escalation-matrix",
                  createdAt: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) },
                },
              });
              if (existingToday) continue;
              await db.notification.create({
                data: {
                  userId: admin.id,
                  type: "escalation_verification_due",
                  title: `${staleCount} escalation contact${staleCount === 1 ? "" : "s"} need verification`,
                  body: `${staleCount} contact${staleCount === 1 ? " has" : "s have"} not been verified in over 90 days. Confirm each contact's details are current. A wrong number costs the most exactly when the matrix is needed.`,
                  link: "/escalation-matrix",
                },
              });
            }
          } catch (orgErr) {
            console.error(`[cron] Escalation nudge failed for org ${orgId}:`, orgErr);
          }
        }

        console.log(
          `[cron] Escalation verification nudge: ${staleByOrg.size} org(s) with stale contacts`,
        );
      } catch (error) {
        console.error("[cron] Escalation verification nudge error:", error);
      }
    });
  });

  // A misconfigured KMS_PROVIDER must stop the deploy HERE, not surface as a
  // runtime throw on the first encrypt. (Does not require the KEK secret
  // itself — build/CI without MASTER_KEK still boots.)
  try {
    assertKmsProviderConfigured();
  } catch (err) {
    console.error("[server] FATAL: KMS provider misconfigured —", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // Delivery plugins (PROVIDERS_DIR): loaded once at boot so a broken plugin
  // is reported here, in the boot log. A bad plugin is skipped, never fatal.
  const plugins = await ensurePluginsLoaded();
  console.log(
    `[server] delivery plugins: ${plugins.loaded.length} loaded, ${plugins.errors.length} skipped (${plugins.dir})`,
  );
  for (const w of webhookBootWarnings()) console.warn(`[server] WARNING: delivery ${w}`);

  // A SET but unusable signing key silently disables signing (exports refuse,
  // ledger heads go unsigned): say so loudly instead.
  const signingProblem = signingKeyProblem();
  if (signingProblem) {
    console.warn(
      [
        "[server] ============================================================",
        `[server] WARNING: ${signingProblem}`,
        "[server] Case-file exports are DISABLED and ledger heads are NOT signed until this is fixed.",
        "[server] ============================================================",
      ].join("\n"),
    );
  }

  console.log(
    `[server] ${registeredCronCount} cron job${registeredCronCount === 1 ? "" : "s"} registered`,
  );

  // Exercises: room authorizer, exercise crons (deadline sweep, housekeeping),
  // the job worker, and inject timers re-armed after a restart.
  registerInfraCrons();
  await bootRuntime();
  const exerciseCronCount = startExerciseCrons();
  startJobWorker();
  console.log(`[server] exercises: ${exerciseCronCount} cron job${exerciseCronCount === 1 ? "" : "s"} registered; job worker running`);

  // API writes from any other Origin get a 403 (src/lib/security/csrf.ts);
  // log what is accepted so a PUBLIC_URL mismatch is visible at boot.
  console.log(`[server] CSRF: allowed origin ${describeCsrfAllowedOrigins()}`);

  // First-run setup code: on a fresh install (zero users) print a one-time code
  // to this log; /setup requires it. Stored hashed on globalThis, which the
  // in-process Next route handlers share. A DB hiccup here is not fatal: the
  // /setup page issues one lazily on first view. See src/lib/setup/setup-code.ts.
  try {
    await ensureSetupCode(() => db.user.count());
  } catch (err) {
    console.warn(
      "[server] could not check for first-run setup at boot (will retry on first /setup view):",
      err instanceof Error ? err.message : err,
    );
  }

  httpServer.listen(port, () => {
    console.log(
      `> Crucible CE ready: listening on port ${port}${process.env.PUBLIC_URL ? `, open ${process.env.PUBLIC_URL}` : ""} (Socket.io enabled)`
    );
  });

  // -----------------------------------------------------------------------
  // Graceful shutdown
  // -----------------------------------------------------------------------
  // Container platforms send SIGTERM with a short grace period (~30s typical)
  // before SIGKILL. Without this handler every restart hard-kills in-flight
  // HTTP, drops Socket.io connections without `disconnecting` events, and
  // tears down Postgres / Redis sockets simultaneously.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal} received — beginning graceful shutdown`);

    const overallDeadlineMs = 25_000;
    const deadline = setTimeout(() => {
      console.warn("[server] Shutdown deadline exceeded — forcing exit");
      process.exit(1);
    }, overallDeadlineMs);
    deadline.unref();

    stopExerciseCrons();
    await stopJobWorker().catch(() => {});

    try {
      // Drain Socket.io: stops accepting new connections, sends disconnecting
      // to existing sockets, then closes.
      await new Promise<void>((resolve) => io.close(() => resolve()));
      console.log("[server] Socket.io closed");
    } catch (err) {
      console.warn("[server] Socket.io close error:", err);
    }

    try {
      await new Promise<void>((resolve, reject) =>
        httpServer.close((err) => (err ? reject(err) : resolve())),
      );
      console.log("[server] HTTP server closed");
    } catch (err) {
      console.warn("[server] HTTP server close error:", err);
    }

    try {
      await db.$disconnect();
      console.log("[server] Prisma disconnected");
    } catch (err) {
      console.warn("[server] Prisma disconnect error:", err);
    }

    clearTimeout(deadline);
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
});
