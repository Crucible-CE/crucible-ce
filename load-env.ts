// ---------------------------------------------------------------------------
// Dev sidecar env loader.
//
// The Next.js process (:3000) loads `.env.local` automatically; the standalone
// Socket.io + cron sidecar (:3001, plain `tsx server-socket.ts`) does not, so
// Prisma and friends boot with no DATABASE_URL and the crons throw. This module
// loads `.env.local` (then `.env`) into process.env and MUST be imported before
// any module that reads process.env at import time (e.g. the Prisma client).
//
// Dependency-free on purpose: pulling in dotenv/@next/env here would register an
// unlisted dependency. Real env vars and earlier files take precedence.
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { resolve } from "path";

for (const file of [".env.local", ".env"]) {
  try {
    const content = readFileSync(resolve(process.cwd(), file), "utf8");
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (process.env[key] !== undefined) continue; // real env / earlier file wins
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  } catch {
    // file not present — fine
  }
}
