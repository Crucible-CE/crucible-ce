import type { Metadata } from "next";
import Image from "next/image";

export const metadata: Metadata = {
  title: "Exercise",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

// Participant pages: no app shell, phone and tablet first. The brand row is
// not a link: guests can reach only their own exercise.
export default function PlayLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-screen max-w-[1200px] px-4 pb-10 sm:px-6">
      <div className="flex h-14 items-center">
        <Image src="/branding/logos/mark.svg" alt="Crucible CE" width={28} height={28} priority unoptimized className="h-7 w-7 sm:hidden" />
        <Image src="/branding/logos/wordmark.svg" alt="Crucible CE" width={206} height={32} priority unoptimized className="logo-on-light hidden h-6 w-auto sm:block" />
        <Image src="/branding/logos/wordmark-dark.svg" alt="Crucible CE" width={206} height={32} priority unoptimized className="logo-on-dark hidden h-6 w-auto sm:block" />
      </div>
      {children}
    </div>
  );
}
