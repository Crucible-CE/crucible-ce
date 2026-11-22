import type { Metadata } from "next";
import { publicStatusView, resolveStatusPageToken } from "@/lib/incident/status-page";
import { StatusSubscribeForm } from "./subscribe-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Status",
  robots: { index: false, follow: false, nocache: true },
};

const STATUS_STYLE: Record<string, string> = {
  Investigating: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
  Monitoring: "bg-blue-100 text-blue-900 dark:bg-blue-500/15 dark:text-blue-300",
  Resolved: "bg-green-100 text-green-900 dark:bg-green-500/15 dark:text-green-300",
};

function fmt(d: Date | null): string {
  return d ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : "";
}

// Public status page for one incident. The token is the only auth. Shows the
// page title, a public status label and the updates posted to the page.
export default async function PublicStatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const page = await resolveStatusPageToken(token);

  if (!page) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[color:var(--color-background)] p-6">
        <div className="max-w-md rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-8 text-center">
          <h1 className="text-lg font-semibold">This status page is not available</h1>
          <p className="mt-2 text-sm text-[color:var(--color-muted-foreground)]">Contact the organization that shared it.</p>
        </div>
      </main>
    );
  }

  const view = await publicStatusView(page);

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-10">
      <header className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-muted-foreground)]">{view.orgName} status</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold" data-testid="status-title">{view.title}</h1>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLE[view.status]}`} data-testid="status-label">{view.status}</span>
        </div>
        <p className="mt-1 text-[12px] text-[color:var(--color-muted-foreground)]">Last updated {fmt(view.updatedAt)}</p>
      </header>

      <section className="space-y-4" aria-label="Updates">
        {view.updates.length === 0 ? (
          <p className="rounded-[var(--radius-md)] border border-dashed border-[color:var(--color-border)] p-6 text-center text-sm text-[color:var(--color-muted-foreground)]">No updates yet.</p>
        ) : (
          view.updates.map((u) => (
            <article key={u.id} className="rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4" data-testid="status-update">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold">{u.headline}</h2>
                <time className="text-[11px] text-[color:var(--color-muted-foreground)]">{fmt(u.publishedToPageAt)}</time>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-[color:var(--color-muted-foreground)]">{u.body}</p>
            </article>
          ))
        )}
      </section>

      <section className="mt-10 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-5">
        <h2 className="text-sm font-semibold">Get updates by email</h2>
        <p className="mt-1 text-[12px] text-[color:var(--color-muted-foreground)]">We send a confirmation first.</p>
        <StatusSubscribeForm token={token} />
      </section>
    </main>
  );
}
