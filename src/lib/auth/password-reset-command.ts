// Server recovery command: `npm run reset-password -- --email <email> [--reset-mfa]`
// (scripts/reset-password.ts). For a locked-out administrator on a server
// without email. Prints a one-time reset link (the same link the forgot-password
// email carries). With --reset-mfa it also removes the account's two-factor
// methods and ends its sessions, exactly like the admin "Reset two-factor"
// action. Audited with the actor "server console". Anyone who can run this
// already controls the server and its database.

import { db } from "@/lib/db";
import { recordAdminAuditLog } from "@/lib/admin-audit";
import { issuePasswordResetLink } from "./password-reset";
import { resetMemberMfa, type MfaResetActor } from "./mfa/admin-reset";

export const CONSOLE_ACTOR: MfaResetActor = {
  userId: "server-console",
  email: null,
  name: "server console",
  label: null,
  via: "server_console",
};

const USAGE = "usage: npm run reset-password -- --email <email> [--reset-mfa]";

export interface CommandIO {
  out: (line: string) => void;
  err: (line: string) => void;
}

type Parsed = { ok: true; email: string; resetMfa: boolean } | { ok: false; error: string | null };

export function parseResetArgs(argv: string[]): Parsed {
  let email: string | null = null;
  let resetMfa = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue;
    if (a === "--help" || a === "-h") return { ok: false, error: null };
    if (a === "--reset-mfa") resetMfa = true;
    else if (a === "--email") email = argv[i + 1]?.startsWith("--") ? "" : (argv[++i] ?? "");
    else if (a.startsWith("--email=")) email = a.slice("--email=".length);
    else return { ok: false, error: `unknown option ${a}` };
  }
  if (!email || !email.trim()) return { ok: false, error: "--email is required" };
  return { ok: true, email: email.toLowerCase().trim(), resetMfa };
}

/** Runs the command; resolves to the process exit code (0 ok, 1 refused, 2 usage). */
export async function runResetPasswordCommand(argv: string[], io: CommandIO): Promise<number> {
  const args = parseResetArgs(argv);
  if (!args.ok) {
    if (args.error) io.err(`error: ${args.error}`);
    io.err(USAGE);
    return 2;
  }

  const user = await db.user.findUnique({
    where: { email: args.email },
    select: { id: true, email: true, name: true, role: true, isActive: true, organizationId: true },
  });
  if (!user) {
    io.err(`No account uses ${args.email}.`);
    return 1;
  }
  if (!user.isActive) {
    io.err(`${user.email} is deactivated. Activate it in Org admin > Members first.`);
    return 1;
  }

  if (args.resetMfa) await resetMemberMfa(user, CONSOLE_ACTOR);
  const link = await issuePasswordResetLink(user.email);

  await recordAdminAuditLog({
    actorUserId: CONSOLE_ACTOR.userId,
    actorEmail: null,
    actorName: CONSOLE_ACTOR.name,
    organizationId: user.organizationId,
    action: "user.reset_link_created",
    targetType: "user",
    targetId: user.id,
    targetLabel: user.email,
    metadata: { via: "server_console", mfaReset: args.resetMfa, expiresAt: link.expiresAt.toISOString() },
  });

  if (!process.env.PUBLIC_URL?.trim()) io.err("PUBLIC_URL isn't set, so check the address in this link.");
  io.out(`Reset link for ${user.email}. It works once and expires in 1 hour.`);
  io.out(link.url);
  if (args.resetMfa) io.out("Two-factor sign-in was removed and all sessions ended.");
  return 0;
}
