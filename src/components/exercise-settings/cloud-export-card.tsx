"use client";

// Export for Cloud: a file for import into Crucible Cloud when it opens. Templates,
// source documents and user emails only. CE never connects to Cloud.

import { Download } from "lucide-react";
import { Card } from "@/components/ui/card";

export function CloudExportCard() {
  return (
    <Card className="h-fit" data-testid="cloud-export">
      <div className="space-y-3">
        <h2 className="text-base font-semibold">Export for Cloud</h2>
        <p className="text-[12.5px] text-[color:var(--color-muted-foreground)]">
          A file with your templates, source documents and user emails, for import into Crucible Cloud when it opens. Exercises, reports and incidents stay here.
        </p>
        <a
          href="/api/settings/cloud-export"
          className="inline-flex items-center gap-2 rounded-md border border-[color:var(--color-border)] px-3 py-1.5 text-[13px] font-medium hover:bg-[color:var(--color-muted)]"
        >
          <Download className="h-4 w-4" />
          Download export
        </a>
      </div>
    </Card>
  );
}
