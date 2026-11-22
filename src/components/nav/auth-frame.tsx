import Image from "next/image";

// Frame for the join pages: soft background
// glow, the theme-aware wordmark, and a centered column. Same look as the sign-in pages.
export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-gradient-to-br from-orange-500/8 via-emerald-500/5 to-transparent blur-3xl" />
        <div className="absolute -bottom-40 right-0 h-[400px] w-[600px] rounded-full bg-gradient-to-tl from-orange-500/5 to-transparent blur-3xl" />
      </div>

      {/* Dark-ink wordmark on Mist, light-ink on Carbon (.logo-on-light / .logo-on-dark). */}
      <div className="relative z-10 mb-8 flex items-center justify-center">
        <Image src="/branding/logos/wordmark.svg" alt="Crucible CE" width={206} height={32} priority unoptimized className="logo-on-light h-10 w-auto" />
        <Image src="/branding/logos/wordmark-dark.svg" alt="Crucible CE" width={206} height={32} priority unoptimized className="logo-on-dark h-10 w-auto" />
      </div>
      <div className="relative z-10 w-full max-w-md">{children}</div>
    </div>
  );
}

