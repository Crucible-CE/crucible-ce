# Sign-in and two-factor

People sign in with an email address and password. Two-factor sign-in adds a second step. The second step is an authenticator app, a security key or passkey, or a recovery code. An administrator can require it for everyone.

CE has no SSO on purpose. There is no SAML, OIDC, SCIM or social sign-in. Keep Crucible accounts separate from corporate credentials.

## Passwords

- Minimum 8 characters. Hashed with bcrypt (cost 12).
- Failed sign-ins are throttled per client IP, per email, and per email and IP.
- A browser that signed in before skips the per-email delay. It never skips the second step.
- Behind a reverse proxy, set `TRUSTED_PROXY_HOPS`. See [reverse-proxy.md](reverse-proxy.md).
- An email must be verified before it can sign in, unless the invite skipped verification.
- Sessions last at most 8 hours.
- Signing out, changing a password, an admin force-logout or a two-factor reset ends every session of that account.
- A forgotten password is reset with a one-time link. See [Reset a password](#reset-a-password).

## Reset a password

Every way below makes the same kind of link.

- It works once and expires in 1 hour.
- A new link stops the older ones working.
- Only a hash of the link is stored.
- It uses `PUBLIC_URL`.
- Setting the new password signs the account out everywhere.

### Copy a reset link (administrators)

1. Go to **Org admin > Members**.
2. Open the member's row menu and choose **Copy reset link**.
3. Confirm it's you.
4. Copy the link and send it to the member over a channel you trust.

The link is shown once. Each one is logged as `user.reset_link_created`, without the link. You can't do this for your own account. Use **Settings** instead.

### Email a reset link

When email is configured, the row menu also has **Email reset link**. Members can also use **Forgot password?** on the sign-in page. It answers the same way whether or not the address has an account.

Without email, **Forgot password?** says "Email isn't set up on this server. Ask an administrator to reset your password." Nothing is sent.

### Server recovery command

For an administrator who is locked out, run this on the server:

```bash
docker compose exec app npm run reset-password -- --email you@example.com
```

From source, run `npm run reset-password -- --email you@example.com`.

- It prints a reset link. Open it and set a new password.
- Add `--reset-mfa` if you also lost your second factor. It removes your two-factor methods and signs you out everywhere.
- It is logged with the actor "server console".
- It refuses an unknown email or a deactivated account.

### Two-factor after a reset

A new password never skips the second step. If two-factor is on, sign-in still asks for it. Only a two-factor reset removes it.

## Set up two-factor

Go to **Settings > Security**. Until the second step passes, no session exists.

### Authenticator app

Any RFC 6238 (TOTP) app works, such as 1Password, Bitwarden, Google Authenticator, Microsoft Authenticator or Aegis.

1. Click **Set up authenticator app** and confirm your password.
2. Scan the QR code, or type the setup key.
3. Enter the 6-digit code. Save the recovery codes you are shown.

- Each code works once. If codes keep failing, set your phone's clock to automatic.
- The secret is encrypted with a key derived from `MASTER_KEK`.
- **Replace app** sets up a new secret. The old app works until the new one is confirmed.

### Security keys and passkeys

Hardware keys (YubiKey, Titan) and passkeys (Touch ID, Windows Hello, a phone) are supported.

1. Click **Add security key** and confirm it's you.
2. Name the key.
3. Touch the key, or use the fingerprint, face or PIN prompt.

- Add as many keys as you want. Keep a spare.
- Rename and remove keys in **Settings > Security**.
- At sign-in, choose **Use your security key**.
- A sign-in whose signature counter did not go up is refused. Keys that never count are accepted.

**Security keys need https.** Browsers allow WebAuthn only on `https://` or `http://localhost`. The relying party is the host name in `PUBLIC_URL` (or `AUTH_URL` / `NEXTAUTH_URL`).

| `PUBLIC_URL` | Security keys |
| --- | --- |
| `https://crucible.example.com` | Work |
| `http://localhost:3000` | Work |
| `http://crucible.lan:3000`, `http://10.0.0.5:3000`, or an IP address on https | Off. Settings says why. Authenticator apps still work. |

Keys are tied to the host name. If you move to a new domain, members must register their keys again.

### Recovery codes

Your first two-factor method gives you 10 recovery codes. Each one works once in place of a code or key.

- They are shown once. Save them in a password manager or print them.
- Only a keyed hash is stored.
- **Generate new codes** replaces the whole set. The old codes stop working.
- With two or fewer left, Settings, the Ops Room readiness panel and the sign-in page tell you to generate new ones.

### Confirm it's you

Some actions ask for your password again, plus a second factor if two-factor is on.

- Adding or removing a method
- Generating recovery codes
- Turning two-factor off
- For administrators, a two-factor reset, a reset link, and the require-two-factor policy

The confirmation lasts 5 minutes. Signing in counts as one, so you can set up two-factor right after you sign in.

### Turn it off

**Turn off two-factor sign-in** removes every method and recovery code. If your organization requires two-factor, you can't remove your last method. Add a new one first.

## Sign-in flow

After the password, the server creates a pending sign-in that lasts 5 minutes. The session is issued only after the second step passes. Results are in **Org admin > Audit log > Sign-in activity**.

Reaching the second step shows the password was right. Change any password someone else may know.

### Limits on wrong codes

Each attempt is counted before the code is checked. Only successful attempts are given back.

| Limit | Value |
| --- | --- |
| Per pending sign-in | 5 attempts, then the password must be entered again |
| Pending sign-ins per account | 3. A fourth drops the oldest. |
| Per account, in the database | 20 failures per 15 minutes. Holds when Redis is down. |
| Per account and client IP, in Redis | 10 per 15 minutes |
| Per client IP, in Redis | 30 per 15 minutes |

- Each failure also counts against the password throttle.
- A known-device browser is exempt from the per-account database limit. It is counted on its own in Redis. The per-sign-in limit still applies.
- The same limits cover "Confirm it's you".

## Administrators

### Reset a member's two-factor

**Org admin > Members** shows **Two-factor** or **No two-factor** next to each member.

For a member who lost every method and their recovery codes:

1. Confirm who is asking, by phone or in person. Attackers with stolen passwords ask for resets.
2. Open the member's row menu and choose **Reset two-factor**.
3. Confirm it's you.

- The reset removes their authenticator app, security keys and recovery codes. It signs them out everywhere.
- They sign in with their password and set up two-factor again.
- It works on other administrators. CE has one administrator tier.
- The member gets an email when email is configured.
- Each reset is logged as `user.mfa_reset`.
- You can't reset your own account this way. Use **Settings > Security**.

### Require two-factor for everyone

Turn on **Org admin > Members > Sign-in security > Require two-factor sign-in for all members**.

- Members without two-factor are signed out everywhere. At next sign-in they go to a setup page. Every other page and API answers "two-factor sign-in required" until they add a method.
- New members set it up at first sign-in.
- You need two-factor on your own account first. Changing the policy asks you to confirm it's you.
- While it is on, nobody can remove their last method.
- Changes are logged as `org.require_mfa_enabled` (with the number signed out) and `org.require_mfa_disabled`.
- The Ops Room readiness panel shows how many members have no two-factor and whether the policy is on.

> **Enrollment is trust-on-first-use.** Whoever first signs in with a member's password can register their own authenticator. Send initial passwords and reset links over a separate trusted channel. Ask members to set up two-factor right away. A member who sees a method they don't recognize should remove it, change their password and tell an administrator.

## Keys and backups

- `MASTER_KEK` encrypts authenticator secrets and keys the recovery-code hashes. Restore backups with the same `MASTER_KEK`. If it is lost or changed, authenticator apps and recovery codes stop working. Security keys still work. Other members need an administrator's two-factor reset.
- `NEXTAUTH_SECRET` / `AUTH_SECRET` sign the pending sign-in and confirmation cookies. Changing it only cancels sign-ins in progress.
- Redis is required. Compose runs it. Without it, the password throttle and other Redis limits fail open. The database two-factor limits still apply. See [configuration.md](configuration.md).
- Authenticator apps show the account as "Crucible CE (your host)", from `PUBLIC_URL`.

See also [backup-restore.md](backup-restore.md).
