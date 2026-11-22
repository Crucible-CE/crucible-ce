import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

// Never statically prerender the auth pages. Their rendered shell is a
// loading spinner (useSession() starts in "loading"); if a CDN caches that
// across deploys, the browser ends up with stale HTML that references JS
// chunk URLs from a previous build — which never hydrate, so the spinner
// never goes away. force-dynamic forces per-request rendering and emits
// no-cache headers on the response.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4">
      {/* Background gradient */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-gradient-to-br from-orange-500/8 via-emerald-500/5 to-transparent blur-3xl" />
        <div className="absolute -bottom-40 right-0 h-[400px] w-[600px] rounded-full bg-gradient-to-tl from-orange-500/5 to-transparent blur-3xl" />
      </div>

      {/* Theme-aware: dark-ink wordmark on Mist, light-ink (white) on
          Carbon. Visibility is gated by `.logo-on-light` / `.logo-on-dark`
          rules in globals.css that key off `<html data-theme>` — see
          comment in globals.css. */}
      <div className="relative z-10 mb-8 flex items-center justify-center">
        <Image
          src="/branding/logos/wordmark.svg"
          alt="Crucible CE"
          width={206}
          height={32}
          priority
          unoptimized
          className="logo-on-light h-10 w-auto"
        />
        <Image
          src="/branding/logos/wordmark-dark.svg"
          alt="Crucible CE"
          width={206}
          height={32}
          priority
          unoptimized
          className="logo-on-dark h-10 w-auto"
        />
      </div>
      <div className="relative z-10 w-full max-w-md">{children}</div>
    </div>
  );
}
