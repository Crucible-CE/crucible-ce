// Confirm a client-side "unauthenticated" with the server before acting on it.
//
// next-auth's client turns a FAILED /api/auth/session fetch into `null`, the
// same value it uses for "signed out": a fetch aborted by a navigation, an
// offline blip or a 5xx all flip useSession() to "unauthenticated" (and log
// `ClientFetchError: Failed to fetch` from next-auth's internal logger, which
// has no hook). The platform shell's stale-cookie self-heal must not sign a
// user out on that, so it asks the server directly first:
//   - "signed-out": the server answered and there is no session (stale or
//     revoked cookie) -> clear it;
//   - "signed-in":  the server still has a session -> resync the client;
//   - "unknown":    the check itself failed -> do nothing (middleware still
//     gates the next navigation).

export type SessionVerdict = "signed-in" | "signed-out" | "unknown";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function confirmSessionState(
  opts: { fetch?: FetchLike; attempts?: number; delayMs?: number } = {},
): Promise<SessionVerdict> {
  const doFetch = opts.fetch ?? ((input, init) => fetch(input, init));
  const attempts = Math.max(1, opts.attempts ?? 3);
  const delayMs = opts.delayMs ?? 1000;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, delayMs * i));
    try {
      const res = await doFetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
      if (res.ok) {
        const body = (await res.json().catch(() => undefined)) as { user?: unknown } | null | undefined;
        if (body === undefined) continue; // unreadable body: treat as a failed check
        return body && typeof body === "object" && body.user ? "signed-in" : "signed-out";
      }
      if (res.status === 401) return "signed-out";
    } catch {
      // Aborted / network error: retry, then give up as "unknown".
    }
  }
  return "unknown";
}
