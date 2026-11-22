// Reset a password from the server, for an administrator locked out on an
// install without email (docs/authentication.md, "Reset a password").
//
//   docker compose exec app npm run reset-password -- --email you@example.com [--reset-mfa]
//   npm run reset-password -- --email you@example.com            (from source)
//
// Prints a one-time reset link under PUBLIC_URL. --reset-mfa also removes the
// account's two-factor methods and ends its sessions. The logic lives in
// src/lib/auth/password-reset-command.ts.

import "../load-env";
import { db } from "../src/lib/db";
import { runResetPasswordCommand } from "../src/lib/auth/password-reset-command";

runResetPasswordCommand(process.argv.slice(2), {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
})
  .catch((err: unknown) => {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  })
  .then(async (code) => {
    await db.$disconnect().catch(() => undefined);
    process.exit(code);
  });
