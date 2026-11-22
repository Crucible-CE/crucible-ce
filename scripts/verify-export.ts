// Verify a Crucible CE case-file export (.cxz) — for the people who RECEIVE one.
//
//   npm run verify-export -- <casefile.cxz> --public-key <sender.pem | base64> [--out decrypted.zip]
//   npx tsx scripts/verify-export.ts <casefile.cxz> ...
//
// The passphrase is read from CXZ_PASSPHRASE, or prompted for on the terminal
// (it is never accepted as a command-line argument, which would leak into shell
// history and process listings). A decrypted .zip can be verified directly too.
//
// ORIGIN: pin the sender's Ed25519 public key with --public-key (a PEM file
// path, a PEM string, or base64 PEM / base64 DER SPKI) or EXPORT_VERIFY_PUBLIC_KEY.
// Without a pinned key the embedded key only proves the package wasn't changed
// since it was sealed — by ANYONE — so the tool refuses (exit 3) unless you
// pass --allow-untrusted.
//
// Exit codes: 0 = PASS, 1 = FAIL, 2 = usage error,
//             3 = integrity PASS but UNTRUSTED origin (no pinned key, no --allow-untrusted).
// Node only; no network, no connection to any Crucible install.

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import {
  UNTRUSTED_MESSAGE,
  formatVerifyReport,
  parseTrustedPublicKey,
  verifyCaseFileZip,
  verifyCxz,
} from "../src/lib/export/verify";

function usage(msg?: string): never {
  if (msg) console.error(`error: ${msg}\n`);
  console.error(
    "usage: npm run verify-export -- <casefile.cxz | casefile.zip> --public-key <sender.pem | base64-key>\n" +
      "                               [--allow-untrusted] [--out <decrypted.zip>]\n" +
      "       passphrase: set CXZ_PASSPHRASE, or enter it when prompted\n" +
      "       pinned key: --public-key, or set EXPORT_VERIFY_PUBLIC_KEY",
  );
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const out: { file?: string; publicKey?: string; outZip?: string; allowUntrusted: boolean } = { allowUntrusted: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--public-key") out.publicKey = argv[++i] ?? usage("--public-key needs a file or key");
    else if (a === "--out") out.outZip = argv[++i] ?? usage("--out needs a file");
    else if (a === "--allow-untrusted") out.allowUntrusted = true;
    else if (a === "--passphrase") usage("pass the passphrase via CXZ_PASSPHRASE or the prompt, not an argument");
    else if (a === "-h" || a === "--help") usage();
    else if (a.startsWith("--")) usage(`unknown option ${a}`);
    else if (!out.file) out.file = a;
    else usage(`unexpected argument ${a}`);
  }
  if (!out.file) usage("missing the package file");
  return out as { file: string; publicKey?: string; outZip?: string; allowUntrusted: boolean };
}

/** --public-key / EXPORT_VERIFY_PUBLIC_KEY: a file path, or the key itself (PEM / base64). */
function resolvePinnedKey(arg: string | undefined): string | undefined {
  const raw = arg ?? process.env.EXPORT_VERIFY_PUBLIC_KEY?.trim();
  if (!raw) return undefined;
  let text = raw;
  if (!raw.includes("-----BEGIN") && existsSync(raw) && statSync(raw).isFile()) {
    text = readFileSync(raw, "utf8");
  }
  try {
    return parseTrustedPublicKey(text);
  } catch (err) {
    usage(`invalid public key: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Prompt without echoing the passphrase. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    let muted = false;
    const output = new Writable({
      write(chunk, _enc, cb) {
        if (!muted) process.stdout.write(chunk);
        cb();
      },
    });
    const rl = createInterface({ input: process.stdin, output, terminal: true });
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
    muted = true;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bytes = readFileSync(args.file);
  const trustedPublicKeyPem = resolvePinnedKey(args.publicKey);
  const isZip = bytes.subarray(0, 2).toString("latin1") === "PK";

  let ok: boolean;
  if (isZip) {
    const report = await verifyCaseFileZip(bytes, { trustedPublicKeyPem });
    console.log(formatVerifyReport(report));
    ok = report.ok;
  } else {
    const passphrase =
      process.env.CXZ_PASSPHRASE?.trim() ||
      (process.stdin.isTTY ? await promptHidden("Passphrase: ") : usage("set CXZ_PASSPHRASE (no terminal to prompt on)"));
    if (!passphrase) usage("empty passphrase");
    const { report, zip } = await verifyCxz(bytes, passphrase, { trustedPublicKeyPem });
    console.log(formatVerifyReport(report));
    ok = report.ok;
    if (zip && args.outZip) {
      writeFileSync(args.outZip, zip);
      console.log(`\nDecrypted archive written to ${args.outZip}`);
    }
  }
  if (!ok) process.exit(1);
  if (!trustedPublicKeyPem) {
    console.error(`\n${UNTRUSTED_MESSAGE}`);
    if (!args.allowUntrusted) {
      console.error("Refusing to report success without a pinned key; pass --allow-untrusted to accept this.");
      process.exit(3);
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
