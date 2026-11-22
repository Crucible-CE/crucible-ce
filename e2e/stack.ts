// Brings the e2e Docker stack up and down (used by global-setup / global-teardown,
// and runnable by hand: `npx tsx e2e/stack.ts up|down|logs|code`).
//
// The stack runs under its own compose project (ce-e2e) on its own host ports,
// so it never touches a self-host `crucible-ce` project on the same machine.
// Every run gets fresh secrets and a fresh Ed25519 export-signing key, written
// to e2e/.state/ (gitignored).

import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(__dirname, "..");
export const STATE_DIR = path.join(__dirname, ".state");
const ENV_FILE = path.join(STATE_DIR, "e2e.env");
const STATE_FILE = path.join(STATE_DIR, "stack.json");

export const PROJECT = process.env.E2E_COMPOSE_PROJECT ?? "ce-e2e";
export const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3200);
export const MAILPIT_PORT = Number(process.env.E2E_MAILPIT_PORT ?? 8226);
export const WEBHOOK_PORT = Number(process.env.E2E_WEBHOOK_PORT ?? 3299);
export const BASE_URL = `http://localhost:${APP_PORT}`;
/** The Crucible Cloud trial link the e2e stack runs with. */
export const CLOUD_TRIAL_URL_E2E = "https://cloud.example.test/trial";
export const MAILPIT_URL = `http://127.0.0.1:${MAILPIT_PORT}`;
export const WEBHOOK_URL = `http://127.0.0.1:${WEBHOOK_PORT}`;

export type StackState = {
  setupCode: string;
  webhookSecret: string;
  exportPublicKeyPem: string;
};

const composeArgs = (args: string[]) => [
  "compose",
  "-p",
  PROJECT,
  "-f",
  path.join(ROOT, "docker-compose.yml"),
  "-f",
  path.join(ROOT, "e2e", "docker-compose.e2e.yml"),
  "--env-file",
  ENV_FILE,
  ...args,
];

function compose(args: string[], opts: { capture?: boolean } = {}): string {
  const full = composeArgs(args);
  if (opts.capture) {
    return execFileSync("docker", full, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  }
  const r = spawnSync("docker", full, { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`docker ${full.join(" ")} exited ${r.status}`);
  return "";
}

/** Fresh secrets + export key for this run. */
function writeEnv(): Omit<StackState, "setupCode"> {
  mkdirSync(STATE_DIR, { recursive: true });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  writeFileSync(path.join(STATE_DIR, "export-signing.pub.pem"), pubPem);
  const webhookSecret = randomBytes(24).toString("hex");
  const env = {
    POSTGRES_PASSWORD: randomBytes(16).toString("hex"),
    NEXTAUTH_SECRET: randomBytes(32).toString("base64"),
    MASTER_KEK: randomBytes(32).toString("hex"),
    PUBLIC_URL: BASE_URL,
    CRUCIBLE_PORT: String(APP_PORT),
    E2E_MAILPIT_PORT: String(MAILPIT_PORT),
    E2E_WEBHOOK_PORT: String(WEBHOOK_PORT),
    DELIVERY_WEBHOOK_SECRET: webhookSecret,
    EXPORT_SIGNING_PRIVATE_KEY: Buffer.from(privPem).toString("base64"),
    CLOUD_TRIAL_URL: CLOUD_TRIAL_URL_E2E,
  };
  writeFileSync(
    ENV_FILE,
    Object.entries(env)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n",
  );
  return { webhookSecret, exportPublicKeyPem: pubPem };
}

export function up(): void {
  const partial = writeEnv();
  // Start from nothing: a fresh install is what step 1 tests.
  compose(["down", "-v", "--remove-orphans"]);
  compose(["up", "-d", "--build", "--wait", "--wait-timeout", "420"]);
  const setupCode = readSetupCode();
  writeFileSync(STATE_FILE, JSON.stringify({ ...partial, setupCode }, null, 2));
}

export function down(): void {
  if (!existsSync(ENV_FILE)) return;
  // Keep the stack's logs next to the Playwright output (uploaded by CI on failure).
  try {
    mkdirSync(path.join(ROOT, "test-results"), { recursive: true });
    writeFileSync(path.join(ROOT, "test-results", "e2e-stack.log"), compose(["logs", "--no-color", "--timestamps"], { capture: true }));
  } catch {
    // Best effort: the stack may never have started.
  }
  compose(["down", "-v", "--remove-orphans"]);
}

export function logs(service = "app"): string {
  return compose(["logs", "--no-color", service], { capture: true });
}

/** `docker compose -p ce-e2e exec app <cmd...>` in the running stack (no TTY). Never throws. */
export function appExec(cmd: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("docker", composeArgs(["exec", "-T", "app", ...cmd]), { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export function readSetupCode(): string {
  const out = logs("app");
  const matches = [...out.matchAll(/first-run setup code:\s*([A-Z0-9-]+)/gi)];
  if (matches.length === 0) throw new Error("no setup code in `docker compose logs app`");
  return matches[matches.length - 1][1];
}

export function readState(): StackState {
  return JSON.parse(readFileSync(STATE_FILE, "utf8")) as StackState;
}

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === "up") up();
  else if (cmd === "down") down();
  else if (cmd === "logs") process.stdout.write(logs(process.argv[3]));
  else if (cmd === "code") console.log(readSetupCode());
  else {
    console.error("usage: tsx e2e/stack.ts up|down|logs [service]|code");
    process.exit(2);
  }
}
