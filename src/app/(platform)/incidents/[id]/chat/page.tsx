"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { IncidentChat } from "@/components/incident/incident-chat";
import { ResponseTeam } from "@/components/incident/response-team";
import { WarRoomBridge } from "@/components/incident/war-room-bridge";

export default function IncidentChatPage() {
  const { id } = useParams<{ id: string }>();
  const [reporter, setReporter] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/incidents/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setReporter(d.reportedBy?.name ?? null))
      .catch(() => {});
  }, [id]);

  return (
    <div>
      <WarRoomBridge incidentId={id} />
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <IncidentChat incidentId={id} />
      <div className="space-y-3">
        <p className="px-1 text-[11px] text-[color:var(--color-muted-foreground)]">
          Type @name to notify a teammate.
        </p>
        <ResponseTeam incidentId={id} reportedByName={reporter} />
      </div>
      </div>
    </div>
  );
}
