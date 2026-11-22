"use client";

import { useParams } from "next/navigation";
import { IncidentPlaybooks } from "@/components/incident/playbooks/incident-playbooks";

// Playbooks: playbook documents run as checklists for this incident.
export default function IncidentPlaybooksPage() {
  const { id } = useParams<{ id: string }>();
  return <IncidentPlaybooks incidentId={id} />;
}
