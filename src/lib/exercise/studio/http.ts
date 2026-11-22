// Error mapping for Studio and portable template routes.
import { NextResponse } from "next/server";
import { ServiceError, toHttpError } from "@/lib/exercise/errors";
import { StudioError } from "./service";

export function studioErrorResponse(e: unknown): Response {
  if (e instanceof StudioError) return NextResponse.json({ error: e.message, issues: e.issues }, { status: e.status });
  if (e instanceof ServiceError) {
    const details = (e as { details?: unknown }).details;
    return NextResponse.json(details === undefined ? { error: e.message } : { error: e.message, details }, { status: e.status });
  }
  return toHttpError(e);
}

export const NO_STORE = { "Cache-Control": "no-store" } as const;
