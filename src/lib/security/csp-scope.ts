// Which responses get the middleware's per-request PAGE CSP.
//
// Next 15 semantics (verified in next/dist/server/lib/router-server.js +
// send-response.js): headers the middleware sets on NextResponse.next() are
// written to the outgoing response FIRST, and the route handler's own headers
// are then only appended when not already present (except set-cookie / vary /
// *-authenticate). So a middleware CSP on /api/* would silently REPLACE a route
// handler's CSP — e.g. the `sandbox` CSP every file download sets
// (lib/http/file-response). API routes return JSON or files, never HTML that
// runs our scripts, so the page CSP is not applied to /api/*: route handlers own
// their CSP there.
export function shouldApplyPageCsp(pathname: string): boolean {
  return !(pathname === "/api" || pathname.startsWith("/api/"));
}
