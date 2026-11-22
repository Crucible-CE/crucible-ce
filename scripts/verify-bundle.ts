// Verify an AAR evidence bundle offline.
//   npx tsx scripts/verify-bundle.ts --key <keyId|public-key.pem> [--key ...] <bundle.zip>
//
// Pin the signer with --key: a 16 character key ID from Org admin, Exercises, Signing keys
// on the install, or a public key file downloaded there. Pass --key twice
// when the record and the manifest were signed by different keys (rotation).
//
// Exit codes:
//   0  PASS: every check passed and every key used is pinned.
//   1  FAIL: a check failed, or a key used is not pinned.
//   2  UNPINNED: the checks passed with the key inside the bundle, but no
//      --key was given, so the signer is not confirmed.
//   3  usage error.
import { readFileSync, statSync } from "node:fs";
import { checkPins, parsePin, verifyBundle, type KeyPin } from "../src/lib/exercise/aar/verify";

/** A bundle file larger than this is refused before reading. */
const MAX_BUNDLE_BYTES = 200 * 1024 * 1024;

const USAGE = "Usage: npx tsx scripts/verify-bundle.ts --key <keyId|public-key.pem> <bundle.zip>";

function usage(message?: string): never {
  if (message) console.error(message);
  console.error(USAGE);
  process.exit(3);
}

async function main() {
  const args = process.argv.slice(2);
  const pins: KeyPin[] = [];
  let file: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--key" || a.startsWith("--key=")) {
      const v = a === "--key" ? args[++i] : a.slice("--key=".length);
      if (!v) usage("--key needs a key ID or a public key file.");
      const pin = parsePin(v, (p) => readFileSync(p, "utf8"));
      if (!pin) usage(`${v} is not a 16 character key ID or an Ed25519 public key file.`);
      pins.push(pin);
    } else if (a.startsWith("-")) {
      usage(`Unknown option ${a}.`);
    } else if (file) {
      usage("Give one bundle file.");
    } else {
      file = a;
    }
  }
  if (!file) usage();

  let bytes: Buffer;
  try {
    if (statSync(file).size > MAX_BUNDLE_BYTES) usage(`${file} is larger than ${MAX_BUNDLE_BYTES} bytes.`);
    bytes = readFileSync(file);
  } catch (err) {
    usage(`Could not read ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const r = await verifyBundle(bytes);
  if (!r.ok) {
    console.log("FAIL");
    for (const reason of r.reasons) console.log(`  - ${reason}`);
    process.exit(1);
  }
  if (pins.length === 0) {
    console.log("UNPINNED: signature valid with the bundled key; pass --key to confirm the signer");
    console.log(`  record key ${r.keyId}`);
    if (r.manifestKeyId && r.manifestKeyId !== r.keyId) console.log(`  manifest key ${r.manifestKeyId}`);
    process.exit(2);
  }
  const pinned = checkPins(r, pins);
  if (!pinned.ok) {
    console.log("FAIL");
    for (const reason of pinned.reasons) console.log(`  - ${reason}`);
    process.exit(1);
  }
  console.log("PASS");
  console.log(`  key ${r.keyId}${r.manifestKeyId && r.manifestKeyId !== r.keyId ? `, manifest key ${r.manifestKeyId}` : ""} (pinned)`);
  console.log(`  content hash ${r.contentHash}`);
  console.log(`  ${r.files} files match the signed manifest`);
  process.exit(0);
}

void main();
