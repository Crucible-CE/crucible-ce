import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";

// Global 404. Renders inside the root layout only, so it carries its own
// minimal chrome, enough to route lost visitors without the full marketing
// nav (which would be wrong inside the app shell too).
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <Link href="/" aria-label="Crucible home">
        <Image
          src="/branding/logos/wordmark.svg"
          alt="Crucible CE"
          width={155}
          height={24}
        />
      </Link>
      <p className="mt-10 font-mono text-[12px] uppercase tracking-[0.12em] text-[color:var(--mist-navy)]">
        404
      </p>
      <h1 className="mt-3 font-[family-name:var(--font-display)] text-[28px] font-semibold tracking-[-0.02em]">
        Page not found
      </h1>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button asChild>
          <Link href="/">Go home</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
