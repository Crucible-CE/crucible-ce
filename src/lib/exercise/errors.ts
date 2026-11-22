// Map runtime and service errors to HTTP responses. Every exercise route
// wraps its body in withErrors() (or calls toHttpError in a catch).
//
//   TransitionError, ResponseError, NotFoundError, AccessError, ServiceError
//     -> their .status and { error: message }
//   ZodError -> 400 with the flattened issues
//   Prisma unique violation (P2002) -> 409
//   anything else -> 500, logged

// No next/server import: this module is reachable from the server boot path,
// which runs before Next is ready. Response.json is the standard Web API.
import { ZodError } from "zod";
import { TransitionError } from "@/lib/exercise/runtime/transition";
import { ResponseError } from "@/lib/exercise/runtime/types";
import { NotFoundError } from "@/lib/exercise/runtime/snapshot";
import { AccessError } from "@/lib/exercise/runtime/view";

/** A plain error with an HTTP status, thrown by src/exercises services. */
export class ServiceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

const STATUS_ERRORS = [TransitionError, ResponseError, NotFoundError, AccessError, ServiceError];

function statusOf(e: unknown): number | null {
  if (STATUS_ERRORS.some((C) => e instanceof C)) {
    const s = (e as { status?: unknown }).status;
    return typeof s === "number" && s >= 400 && s < 600 ? s : 500;
  }
  return null;
}

/** Turn a thrown error into a JSON response. Never throws. */
export function toHttpError(e: unknown): Response {
  const status = statusOf(e);
  if (status !== null) {
    // A 500 from a transition table violation is a server bug; do not echo it.
    // ServiceError messages are written for people (for example a missing
    // signing key), so those are shown.
    if (status >= 500 && !(e instanceof ServiceError)) {
      console.error("[exercises] server error:", e);
      return Response.json({ error: "Something went wrong. Try again." }, { status });
    }
    if (status >= 500) console.error("[exercises] server error:", e);
    const message = e instanceof NotFoundError ? "Exercise not found." : (e as Error).message;
    return Response.json({ error: message }, { status });
  }
  if (e instanceof ZodError) {
    return Response.json({ error: "Invalid input", details: e.flatten() }, { status: 400 });
  }
  if ((e as { code?: unknown } | null)?.code === "P2002") {
    return Response.json({ error: "That already exists." }, { status: 409 });
  }
  if ((e as { code?: unknown } | null)?.code === "P2025") {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  console.error("[exercises] unhandled error:", e);
  return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
}

/** Run a route body and map anything it throws. */
export async function withErrors(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    return toHttpError(e);
  }
}
