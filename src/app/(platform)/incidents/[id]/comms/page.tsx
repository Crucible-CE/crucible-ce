"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { StatusUpdates } from "@/components/incident/status-updates";
import { StatusPageCard } from "@/components/incident/status-page-card";
import { StakeholderNotifications } from "@/components/incident/stakeholder-notifications";

// Incident communications: status updates, the public status page, and
// stakeholder notifications for this incident.
export default function IncidentCommsPage() {
  const { id } = useParams<{ id: string }>();
  const [pageVersion, setPageVersion] = useState(0);

  return (
    <div className="space-y-4">
      <StatusUpdates incidentId={id} pageVersion={pageVersion} />
      <StatusPageCard incidentId={id} onChange={() => setPageVersion((v) => v + 1)} />
      <StakeholderNotifications incidentId={id} />
    </div>
  );
}
