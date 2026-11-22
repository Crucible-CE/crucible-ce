# Security policy

## Report a vulnerability

1. Open the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Include a description, steps to reproduce, and the version you tested.

Only the maintainers can see the report. Don't open a public issue, discussion or pull request for anything exploitable.

| Step | Target |
| --- | --- |
| Acknowledgment | Within 5 business days |
| Fix or mitigation plan | Within 30 days for confirmed issues. Faster for critical ones. |
| Disclosure | A GitHub security advisory after the fix ships. A CVE where warranted. Credit if you want it. |

Fixes ship to Crucible CE and the hosted platform together.

For the hosted Crucible platform, use the same form and start the title with `[hosted]`.

## Scope

In scope:

- This repository.
- The official Docker images, once published.

Out of scope:

- Your own deployment's configuration, such as exposed databases, missing TLS or weak secrets.
- Denial of service against your own install.

## Supported versions

Only the latest release line gets security fixes. Upgrade to get a fix.

## Hardening checklist

- Host CE outside your corporate network and identity plane. See [docs/deployment.md](docs/deployment.md).
- Require two-factor sign-in for every account.
- Run CE behind TLS. See [docs/reverse-proxy.md](docs/reverse-proxy.md).
- Behind a reverse proxy, set `TRUSTED_PROXY_HOPS=1` (one per proxy that appends to `X-Forwarded-For`). At `0`, every client shares one rate-limit bucket.
- Keep `MASTER_KEK`, `NEXTAUTH_SECRET` and `EXPORT_SIGNING_PRIVATE_KEY` out of version control. Keep them away from the database host where you can.
- Back up `MASTER_KEK`. It keys the ledger hashes. If you lose it, the ledger can't be verified.
- Keep Postgres and Redis on the internal network. The compose file does not publish them.
- Install only provider plugins you have read. They run with the app's full privileges.
- Keep your checkout current.

The compose defaults assume a single trusted host.

## Built-in protections

- Sign-in is throttled per client IP and per email and IP. After 5 failures the delay grows, up to 15 minutes. There is also a per-account delay across all IPs.
- A browser that signed in to the account before skips the per-account delays. An administrator can clear them with **Unlock sign-in** in user management.
- Signing out ends the session on every device.
- API writes must come from `PUBLIC_URL`. Socket.io refuses other origins.
- `EXPORT_SIGNING_PRIVATE_KEY` signs each ledger head and every case-file export.
- Case-file recipients should verify with the sender's pinned public key (`--public-key`). See [docs/case-file-exports.md](docs/case-file-exports.md).
