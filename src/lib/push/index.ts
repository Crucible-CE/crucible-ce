// ---------------------------------------------------------------------------
// Crucible CE push stub.
// ---------------------------------------------------------------------------
// Mobile push delivery (APNs/FCM device registration) is a Crucible Cloud
// feature. CE keeps the notification pipeline's shape but push is a no-op:
// in-app and email channels carry every notification.
// ---------------------------------------------------------------------------

export interface PushPayload {
  title: string;
  body: string;
  link?: string;
  critical?: boolean;
}

export interface PushResult {
  sent: number;
  devices: number;
}

export async function sendPushToUser(_userId: string, _payload: PushPayload): Promise<PushResult> {
  return { sent: 0, devices: 0 };
}
