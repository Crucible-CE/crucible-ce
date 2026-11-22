# Deployment

Best practice is to host CE outside your corporate network and identity plane. How you host it and secure access to it is up to you. This page lists what to consider.

## Where to host

- **Separate infrastructure.** Use a cloud account, VPS provider or region with no link to your corporate environment. No VPC peering, no domain join, no corporate configuration management or EDR.
- **Separate admin accounts.** Keep the hosting account's admin credentials out of your corporate identity provider and password manager. Use hardware-key MFA on the hosting account.
- **Own domain and DNS.** Use a registrar and DNS provider outside your corporate accounts.
- **Independent delivery.** Send email through an outside provider, not your corporate mail server. Use your own Twilio account for SMS and voice. See [paging.md](paging.md).
- **Backups elsewhere.** Store database and upload backups, and a copy of `MASTER_KEK`, away from both the CE host and your corporate environment. See [backup-restore.md](backup-restore.md).

## Secure access

CE is reachable from the internet unless you restrict it.

- **TLS.** Put CE behind a reverse proxy with a valid certificate. Set `PUBLIC_URL` to the https address. Security keys and passkeys need https outside localhost. See [reverse-proxy.md](reverse-proxy.md).
- **Network access control.** For example, an IP allowlist at the proxy or firewall, a VPN that does not use your corporate identity provider, or mutual TLS with client certificates.
- **Two-factor sign-in.** CE supports authenticator apps, security keys, passkeys and recovery codes. Turn on **Require two-factor sign-in for all members** in **Org admin > Members**. See [authentication.md](authentication.md).
- **Exercise guests.** Guests join an exercise with an invite code and no account. They need to reach CE at `PUBLIC_URL`. If you restrict access, give them a way in for the exercise, or add them as members instead. See [exercises.md](exercises.md#invites-and-joining).
- **Break-glass plan.** Decide how responders reach CE if their usual device or network is down. Keep at least two administrators with working second factors.

## No SSO

CE has no SSO on purpose. It keeps its own accounts. Protect them with two-factor sign-in.

## Crucible Cloud

Crucible Cloud is the hosted version. It runs on infrastructure separate from yours, with managed paging and AI for exercises. It will include the same hardened sign-in, with hardware security keys and one-time passcodes.
