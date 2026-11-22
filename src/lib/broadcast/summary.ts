// Delivery and acknowledgement counts of a broadcast (pure).

export interface BroadcastSummary {
  recipientCount: number;
  ackedCount: number;
  /** Per channel: attempts sent, failed, skipped, pending. */
  channelSummary: Record<string, { sent: number; failed: number; skipped: number; pending: number }>;
}

export function summarizeBroadcast(recipients: { acknowledgedAt: Date | null; deliveries: { channel: string; status: string }[] }[]): BroadcastSummary {
  const channelSummary: BroadcastSummary["channelSummary"] = {};
  for (const r of recipients) {
    for (const d of r.deliveries) {
      const c = (channelSummary[d.channel] ??= { sent: 0, failed: 0, skipped: 0, pending: 0 });
      if (d.status === "sent") c.sent++;
      else if (d.status === "failed") c.failed++;
      else if (d.status === "skipped") c.skipped++;
      else c.pending++;
    }
  }
  return { recipientCount: recipients.length, ackedCount: recipients.filter((r) => r.acknowledgedAt).length, channelSummary };
}
