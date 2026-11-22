"use client";


// global-error renders the root document when a top-level React error
// escapes every error boundary. Has to ship its own <html>/<body>, can't
// rely on root layout. Tailwind classes won't load here (no globals.css
// link), so all styling is inline — kept in line with the Mist palette
// (ember + slate-mist) so the failure mode still reads as our app.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset?: () => void;
}) {
  return (
    <html lang="en" data-theme="forge">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#f6f8fb",
          color: "#0f172a",
          fontFamily:
            'Geist, -apple-system, system-ui, "Segoe UI", sans-serif',
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            maxWidth: 480,
            width: "100%",
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: 3,
            padding: 32,
            textAlign: "center",
          }}
        >
          <div
            aria-hidden
            style={{
              width: 40,
              height: 40,
              borderRadius: 2,
              background: "#ea580c",
              margin: "0 auto 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ffffff",
              fontWeight: 700,
              fontSize: 22,
            }}
          >
            !
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            Something went wrong
          </h1>
          <p
            style={{
              marginTop: 8,
              marginBottom: 24,
              fontSize: 14,
              lineHeight: 1.55,
              color: "#475569",
            }}
          >
            Try again or reload the page. Details are in the server log.
          </p>
          {error?.digest && (
            <div
              style={{
                marginBottom: 20,
                padding: "8px 12px",
                background: "#eef2f7",
                borderRadius: 2,
                fontFamily: "JetBrains Mono, ui-monospace, monospace",
                fontSize: 11,
                color: "#475569",
                wordBreak: "break-all",
              }}
            >
              {error.digest}
            </div>
          )}
          <div
            style={{ display: "flex", gap: 8, justifyContent: "center" }}
          >
            {reset && (
              <button
                type="button"
                onClick={reset}
                style={{
                  height: 36,
                  padding: "0 14px",
                  background: "#ea580c",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: 2,
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Try again
              </button>
            )}
            {/* Plain anchor on purpose — global-error fires when SPA
                navigation is broken; a full reload is the reliable escape. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                height: 36,
                padding: "0 14px",
                background: "#ffffff",
                color: "#0f172a",
                border: "1px solid #e2e8f0",
                borderRadius: 2,
                fontWeight: 500,
                fontSize: 13,
                lineHeight: "36px",
                textDecoration: "none",
              }}
            >
              Go home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
