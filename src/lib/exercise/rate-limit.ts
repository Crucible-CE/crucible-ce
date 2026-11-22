// Rate limits for exercise routes: CE's Redis limiter plus the 429 helper.

export { checkRateLimit, ipFromRequest } from "@/lib/security/rate-limit";

/** Body and init for a 429 with Retry-After. */
export function tooManyRequests(retryAfter: number): { body: { error: string }; init: ResponseInit } {
  return {
    body: { error: "Too many attempts. Try again later." },
    init: { status: 429, headers: { "Retry-After": String(Math.max(1, retryAfter)) } },
  };
}
