// Call a provider defensively: hard timeout, never throws, validates the
// result shape (plugins are third-party code). No DB imports, so the provider
// test harness (scripts/provider-test.ts) can use it standalone.

import { PROVIDER_SEND_TIMEOUT_MS } from "./config";
import type { DeliveryMessage, DeliveryProvider, DeliveryRecipient, DeliveryResult } from "./types";

export async function safeSend(
  provider: DeliveryProvider,
  msg: DeliveryMessage,
  recipient: DeliveryRecipient,
  timeoutMs: number = PROVIDER_SEND_TIMEOUT_MS,
): Promise<DeliveryResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => provider.send(msg, recipient)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`provider timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    if (!result || !["sent", "failed", "skipped"].includes((result as DeliveryResult).status)) {
      return { status: "failed", error: "provider returned an invalid result" };
    }
    return {
      status: result.status,
      providerRef: typeof result.providerRef === "string" ? result.providerRef.slice(0, 500) : undefined,
      error: typeof result.error === "string" ? result.error.slice(0, 1000) : undefined,
    };
  } catch (e) {
    return { status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 1000) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
