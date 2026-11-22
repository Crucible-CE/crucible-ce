// Delivery provider test harness.
//
//   npm run provider:test -- ./providers/example-ntfy.mjs [options]
//
// Loads ONE plugin file exactly the way the server does (same loader, same
// shape validation), prints what it registered, and sends one message through
// it with the same timeout + result validation the delivery engine uses.
//
// Options:
//   --kind page|escalation|ack|test   message kind (default: page)
//   --name "Ada Lovelace"             recipient name (default: Test Recipient)
//   --email ada@example.com           recipient email
//   --phone +15551234567              recipient phone (E.164)
//   --dry-run                         load + validate only, do not send
//
// Exit code: 0 sent (or dry run ok), 2 skipped, 1 failed / load error.

import path from "node:path";
import { loadPluginFile } from "../src/lib/delivery/plugins";
import { safeSend } from "../src/lib/delivery/safe-send";
import type { DeliveryKind, DeliveryMessage, DeliveryRecipient } from "../src/lib/delivery/types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--") && !process.argv[process.argv.indexOf(a) - 1]?.startsWith("--"));
  if (!file) {
    console.error("usage: npm run provider:test -- <path/to/provider.mjs> [--kind page] [--email x] [--phone +1...] [--name n] [--dry-run]");
    return 1;
  }
  const abs = path.resolve(file);
  let provider;
  try {
    provider = await loadPluginFile(abs);
  } catch (e) {
    console.error(`✗ failed to load ${abs}: ${e instanceof Error ? e.message : e}`);
    return 1;
  }
  let configured = false;
  try {
    configured = provider.isConfigured();
  } catch (e) {
    console.error(`isConfigured() threw: ${e instanceof Error ? e.message : e}`);
  }
  console.log(`✓ loaded provider "${provider.id}" (${provider.displayName}) channels=[${provider.channels.join(", ")}] configured=${configured}`);
  if (process.argv.includes("--dry-run")) return 0;

  const kind = (arg("kind") ?? "page") as DeliveryKind;
  const now = new Date();
  const base = process.env.PUBLIC_URL?.trim() || "http://localhost:3000";
  const message: DeliveryMessage = {
    kind,
    id: `harness:${provider.id}:${now.getTime()}`,
    attempt: 1,
    incident: kind === "test" ? null : { id: "inc_harness", title: "Harness test incident", severity: "high", url: `${base}/incidents/inc_harness` },
    page: kind === "test" ? null : { id: "page_harness", level: kind === "escalation" ? 1 : 0, priority: "high" },
    title: kind === "test" ? "Crucible delivery test" : `[HIGH] ${kind === "escalation" ? "Escalated page" : kind === "ack" ? "Acknowledged" : "Paged"}: Harness test incident`,
    text: "This is a test message from the Crucible CE provider harness.",
    ackUrl: kind === "page" || kind === "escalation" ? `${base}/api/public/page-ack/harness-token-not-valid` : null,
    sentAt: now.toISOString(),
  };
  const recipient: DeliveryRecipient = {
    name: arg("name") ?? "Test Recipient",
    email: arg("email") ?? null,
    phone: arg("phone") ?? null,
    userId: null,
    contactId: null,
  };
  console.log("→ sending", JSON.stringify({ message, recipient }, null, 2));
  const result = await safeSend(provider, message, recipient);
  console.log("← result", JSON.stringify(result));
  return result.status === "sent" ? 0 : result.status === "skipped" ? 2 : 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
