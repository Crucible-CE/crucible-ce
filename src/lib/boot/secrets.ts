// ---------------------------------------------------------------------------
// Boot-time secret validation.
//
// Pure, dependency-free: takes an env object, returns a list of problems.
// `server.ts` (and the dev socket sidecar) print the list and exit(1) when it
// is non-empty. Deliberately NOT wired into `next build` or module load: CI and
// the Docker build stage compile with throwaway values (NEXTAUTH_SECRET=ci-...,
// MASTER_KEK=64 zeros) and must keep building. Only a process that is about to
// serve real traffic refuses to start.
//
//   NEXTAUTH_SECRET / AUTH_SECRET  at least one set; every one that IS set must
//                                  be >= 32 chars and not a template placeholder.
//   MASTER_KEK                     must decode to exactly 32 bytes, the way
//                                  src/lib/crypto/org-crypto.ts reads it: 64 hex
//                                  chars, or base64. Never all zeros when
//                                  NODE_ENV=production.
// ---------------------------------------------------------------------------

export const MIN_AUTH_SECRET_LENGTH = 32;

// Substrings that only ever appear in template / example values shipped in
// .env.example, the Dockerfile build stage, CI, and the docs. Matched
// case-insensitively.
const PLACEHOLDER_MARKERS = [
  "change-me",
  "changeme",
  "change_me",
  "generate-with",
  "generate_with",
  "placeholder",
  "replace-me",
  "replace_me",
  "your-secret",
  "your_secret",
  "openssl rand",
];

type Env = Record<string, string | undefined>;

function placeholderMarker(value: string): string | null {
  const lower = value.toLowerCase();
  return PLACEHOLDER_MARKERS.find((m) => lower.includes(m)) ?? null;
}

/** Decode a KEK exactly the way src/lib/crypto/kms.ts does (64 chars = hex, else base64). */
export function decodeKek(raw: string): Buffer | null {
  if (raw.length === 64) {
    // kms.ts uses Buffer.from(raw, "hex"), which silently truncates at the
    // first non-hex char; require real hex so a typo is caught here.
    return /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : null;
  }
  return Buffer.from(raw, "base64");
}

function checkAuthSecret(name: string, value: string, problems: string[]): void {
  const marker = placeholderMarker(value);
  if (marker) {
    problems.push(
      `${name} is still a template placeholder (contains "${marker}"). Generate one with: openssl rand -base64 32`,
    );
    return;
  }
  if (value.length < MIN_AUTH_SECRET_LENGTH) {
    problems.push(
      `${name} is too short (${value.length} chars; minimum ${MIN_AUTH_SECRET_LENGTH}). Generate one with: openssl rand -base64 32`,
    );
  }
}

/**
 * Validate the secrets a serving process depends on. Returns human-readable
 * problems; an empty array means the process may boot.
 */
export function validateBootSecrets(env: Env = process.env): string[] {
  const problems: string[] = [];

  // --- Session / token signing secret ---------------------------------------
  // Different modules read AUTH_SECRET and NEXTAUTH_SECRET in different orders,
  // so every one that is set must be strong, and at least one must be set.
  const authSecrets = (["NEXTAUTH_SECRET", "AUTH_SECRET"] as const)
    .map((name) => ({ name, value: env[name]?.trim() ?? "" }))
    .filter((s) => s.value !== "");
  if (authSecrets.length === 0) {
    problems.push(
      "NEXTAUTH_SECRET (or AUTH_SECRET) is not set. Generate one with: openssl rand -base64 32",
    );
  }
  for (const s of authSecrets) checkAuthSecret(s.name, s.value, problems);

  // --- Encryption-at-rest key-encryption key --------------------------------
  const kekName = "MASTER_KEK";
  const kekRaw = (env.MASTER_KEK ?? "").trim();
  if (kekRaw === "") {
    problems.push("MASTER_KEK is not set. Generate one with: openssl rand -hex 32");
  } else {
    const marker = placeholderMarker(kekRaw);
    const key = marker ? null : decodeKek(kekRaw);
    if (marker) {
      problems.push(
        `${kekName} is still a template placeholder (contains "${marker}"). Generate one with: openssl rand -hex 32`,
      );
    } else if (!key || key.length !== 32) {
      problems.push(
        `${kekName} must decode to exactly 32 bytes (64 hex chars, or base64 of 32 bytes). Generate one with: openssl rand -hex 32`,
      );
    } else if (env.NODE_ENV === "production" && key.every((b) => b === 0)) {
      problems.push(
        `${kekName} is all zeros (the CI/build placeholder). Generate a real key with: openssl rand -hex 32`,
      );
    }
  }

  return problems;
}

/** The fatal boot message for a non-empty problem list. */
export function formatSecretProblems(problems: string[]): string {
  return [
    "[server] FATAL: refusing to start with weak or placeholder secrets:",
    ...problems.map((p) => `  - ${p}`),
    "Set real values in your environment (.env for docker compose, .env.local from source) and restart.",
  ].join("\n");
}
