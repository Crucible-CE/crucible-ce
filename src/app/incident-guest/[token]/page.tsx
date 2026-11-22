import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { resolveGuestToken } from "@/lib/incident/guest";
import { GuestRoom } from "@/components/incident/guest-room";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Incident room",
  robots: { index: false, follow: false, nocache: true },
};

// Guest entry point: the token in the URL is the only credential. A guest sees
// one incident (summary, chat, evidence) and nothing else of the organization.
export default async function IncidentGuestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await resolveGuestToken(token);

  if (!ctx) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[color:var(--color-background)] p-6">
        <div className="max-w-md rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-8 text-center">
          <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-[color:var(--mist-danger)]" aria-hidden />
          <h1 className="mb-2 text-lg font-semibold">This link is not valid</h1>
          <p className="text-sm text-[color:var(--color-muted-foreground)]">Ask your contact for a new link.</p>
        </div>
      </main>
    );
  }

  return <GuestRoom token={token} />;
}
