// The Cloud page call to action: the trial link when CLOUD_TRIAL_URL is set,
// otherwise "Coming soon". CE never shows a trial link that leads nowhere.

import { ArrowUpRight, Clock } from "lucide-react";

export function CloudCallToAction({ trialUrl }: { trialUrl: string | null }) {
  if (trialUrl) {
    return (
      <a
        href={trialUrl}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="cloud-trial"
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[color:var(--mist-indigo)] px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90"
      >
        Try Crucible Cloud free for 1 week
        <ArrowUpRight className="h-3.5 w-3.5" />
      </a>
    );
  }
  return (
    <div className="space-y-1.5">
      <span
        aria-disabled="true"
        data-testid="cloud-coming-soon"
        className="inline-flex cursor-default items-center gap-1.5 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-muted)]/40 px-4 py-2 text-[13px] font-semibold text-[color:var(--color-muted-foreground)]"
      >
        <Clock className="h-3.5 w-3.5" />
        Free 1 week trial coming soon
      </span>
      <p className="text-[12.5px] text-[color:var(--color-muted-foreground)]">
        Crucible Cloud is not open yet. The trial starts when it launches.
      </p>
    </div>
  );
}
