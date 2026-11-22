"use client";

// A report read only, for people outside the control team: program users
// (any version) and readers who took part (final versions). No editing, no
// findings review, no exports.

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatInZone } from "@/lib/exercise/time";
import { HSEEP_TYPE_TEXT } from "@/lib/exercise/aar/labels";
import { ReportView, type ReportActions } from "./report-view";
import { STATUS_LABELS, type AarPageData, type AarSummary } from "./types";

const NO_ACTIONS: ReportActions = {
  save: async () => false,
  refresh: () => {},
  remove: () => {},
};

const SIGNER_TEXT: Record<string, string> = { facilitator: "Facilitator", sponsor: "Sponsor" };

export function AarReadOnly({
  exercise,
  aar,
  signers,
}: {
  exercise: AarPageData["exercise"];
  aar: Pick<AarSummary, "version" | "status" | "sections" | "origins" | "finalizedAt">;
  signers: Array<{ role: string; name: string }>;
}) {
  const tz = exercise.timezone;
  return (
    <div className="space-y-4" data-testid="aar-read-only">
      <Link href="/after-action-reports" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[color:var(--mist-indigo)] hover:underline">
        <ArrowLeft className="h-4 w-4" />
        After-action reports
      </Link>
      <div className="space-y-1">
        <h1 className="headline">{exercise.title}</h1>
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-[color:var(--color-muted-foreground)]">
          <Badge variant={aar.status === "final" ? "success" : "outline"}>{STATUS_LABELS[aar.status] ?? aar.status}</Badge>
          Version {aar.version}
          {aar.finalizedAt ? `. Final ${formatInZone(new Date(aar.finalizedAt), tz)}` : ""}
        </p>
        {signers.length > 0 && (
          <p className="text-[13px] text-[color:var(--color-muted-foreground)]">
            {signers.map((s) => `${SIGNER_TEXT[s.role] ?? s.role}: ${s.name}`).join(". ")}
          </p>
        )}
      </div>
      {aar.sections ? (
        <ReportView
          sections={aar.sections}
          origins={aar.origins}
          editable={false}
          actions={NO_ACTIONS}
          timezone={tz}
          regenerating={false}
          scenarioStart={exercise.scenarioStartAt}
          modeType={HSEEP_TYPE_TEXT[exercise.mode]}
        />
      ) : (
        <Card>
          <p className="text-[14px]">The report content could not be read.</p>
        </Card>
      )}
    </div>
  );
}
