# Case-file exports

A case-file export is an incident package (`.cxz`) for people outside Crucible, such as outside counsel, insurers or regulators. It contains:

- The incident record (timeline, decisions, tasks, status updates, SITREPs, postmortem, evidence manifest)
- A PDF summary
- A signature block

| Property | Detail |
| --- | --- |
| Signed | Ed25519, over `MANIFEST.json`. The manifest lists the SHA-256 of every file. The public key is inside the package. |
| Encrypted | AES-256-GCM, with a key from scrypt and a passphrase |
| Passphrase | Generated when you create the export (four groups of five characters, for example `K7QMX-...`). Shown **once**. Not stored. Can't be recovered. |

- If the passphrase is lost, create a new export.
- Send the passphrase through a different channel than the `.cxz`.
- To prove the package came from you, give the recipient your public key through a separate channel. See [Verify a package](#verify-a-package).

## Enable exports

1. Generate an Ed25519 key.
   ```bash
   openssl genpkey -algorithm ed25519 -out export-signing.pem
   base64 < export-signing.pem | tr -d '\n'   # put this value in EXPORT_SIGNING_PRIVATE_KEY
   ```
2. Set `EXPORT_SIGNING_PRIVATE_KEY` in `.env` to the base64 value. A raw multi-line PEM also works where the environment allows newlines. (`base64 -w0` is GNU-only.)
3. Run `docker compose up -d`.
4. Back up the PEM with `.env`.

- Only administrators can create exports.
- Without the variable, the **Case file** page shows that exporting is disabled.
- A value that isn't a valid Ed25519 PKCS8 key is treated the same way. The server prints a `[server] WARNING:` message at boot. Check the boot log if exports stay disabled.

Rotating the key is covered in [Key rotation](#key-rotation).

## Download

On the incident's **Case file** page, each ready export offers two downloads.

| File | Use |
| --- | --- |
| `.cxz` | The encrypted, signed package. Send this to the recipient. |
| `.zip` | The same package decrypted by the server. Enter the passphrase when asked. It still contains `MANIFEST.json`, `SEAL` and `VERIFY.md`, so it can be verified. |

## Verify a package

The recipient needs Node.js 24 and a checkout of this repository (`npm install` once). The script makes no network calls.

```bash
# Prompts for the passphrase (input is hidden). You can also set CXZ_PASSPHRASE.
# --public-key pins the sender's key, received through a separate channel.
npm run verify-export -- casefile-1a2b3c4d-2026-10-14.cxz --public-key sender-export-signing.pub.pem

# The key can also be given inline (PEM, base64 PEM, or base64 DER SPKI),
# or through EXPORT_VERIFY_PUBLIC_KEY (a path or the key itself):
EXPORT_VERIFY_PUBLIC_KEY=sender-export-signing.pub.pem npm run verify-export -- casefile.cxz

# Also write out the decrypted archive:
npm run verify-export -- casefile.cxz --public-key sender.pub.pem --out casefile.zip

# An already-decrypted .zip can be verified directly:
npm run verify-export -- casefile.zip --public-key sender.pub.pem

# No pinned key available: integrity only, origin explicitly NOT established.
npm run verify-export -- casefile.cxz --allow-untrusted
```

The script prints PASS or FAIL for each check.

1. Decrypts the package and checks the AES-GCM tag.
2. Verifies the Ed25519 `SEAL` over `MANIFEST.json`.
3. Re-hashes every listed file. Flags files the manifest doesn't list.
4. Checks the ledger chain linkage.

The passphrase is never accepted as a command-line argument.

> **Pin the sender's key.** Anyone who can change a package can re-seal it with their own key. Without `--public-key` or `EXPORT_VERIFY_PUBLIC_KEY`, the script prints `UNTRUSTED: signature valid for embedded key only (self-signed, origin unverified)` and exits `3`. `--allow-untrusted` accepts this. The warning still prints and the exit code is `0`.

| Exit code | Meaning |
| --- | --- |
| `0` | PASS |
| `1` | FAIL |
| `2` | Usage error, including a public key that can't be parsed |
| `3` | Integrity passed. Origin untrusted (no pinned key, no `--allow-untrusted`). |

The verifier refuses `.cxz` headers that ask for more than scrypt `N = 2^20`, `r = 16`, `p = 4`, or more than 1 GiB of scrypt memory. It requires a 12-byte IV and a full 16-byte GCM tag.

To give recipients your public key, derive it from the signing key.

```bash
openssl pkey -in export-signing.pem -pubout -out export-signing.pub.pem
```

Without the script, follow `VERIFY.md` inside the package. Any SHA-256 and Ed25519 tool works.

### The ledger in an export

Each ledger entry's `entryHash` is an HMAC-SHA256 of all its fields. The key is derived from `MASTER_KEK` (HKDF-SHA256, info `ledger-v1`). When `EXPORT_SIGNING_PRIVATE_KEY` is set, the chain head is signed on every append. **Verify** in the incident log fails on a bad or missing head signature, or on any mismatch.

Recipients don't have `MASTER_KEK`, so they can't recompute the hashes.

1. At export time, the install re-verifies the chain. It writes `ledgerValid`, `ledgerStatus`, `ledgerHead`, `ledgerEntries` and `ledgerHashScheme` (`hmac-sha256/ledger-v1`) to `MANIFEST.json`.
2. The signed manifest pins `ledgerHead` and the SHA-256 of `ledger.json`.
3. Offline, the verifier checks that `seq` runs 1 to n, the first `prevHash` is 64 zeros, each `prevHash` equals the previous `entryHash`, the last `entryHash` equals `ledgerHead`, and the count matches `ledgerEntries`.

| `ledgerStatus` | Meaning |
| --- | --- |
| `valid` | The chain verified |
| `key_mismatch` | Entries or the head signature were made under a different `MASTER_KEK` or signing key |
| `head_unsigned` | The head names a signing key but its signature is gone |
| `tampered` | Anything else, including entries with no head anchor (`head_missing`) |

The verifier fails closed. The **Ledger hash scheme** check fails for any scheme other than `hmac-sha256/ledger-v1`. The **Ledger verified by issuer** check fails unless `ledgerValid` is `true` and `ledgerStatus` is `valid`.

## Key rotation

Each ledger entry records `keyId`, a public fingerprint of its HMAC key. Each signed head records `ledgerHeadKeyId`, the fingerprint of the signing key. **Verify** uses them to tell a key change from tampering.

| Change | Result |
| --- | --- |
| `MASTER_KEK` changed | Old entries report `key_mismatch`, not `tampered`. It is still not a pass. |
| `EXPORT_SIGNING_PRIVATE_KEY` rotated | Old exports verify against their original public key. Incident heads report `key_mismatch` until the next ledger entry re-signs them. |
| Signing key added later | Older heads report `valid` with an "unsigned (pre-signing)" warning. They are signed on the next entry. |

> **Don't rotate `MASTER_KEK`.** CE v0.1 has no re-keying tool. The ledger, existing exports and encrypted evidence all depend on it. To verify the ledger, restore the original value. Back it up.

- After rotating the signing key, keep giving recipients the old public keys. Add a note to open incidents so their heads are re-signed.
- A signature that doesn't verify under the key it names is `tampered`.
- Key ids are not authenticated. A forged entry can be made to read as `key_mismatch`, but never as `valid`.

> **Treat any result other than `valid` as not verified.**
