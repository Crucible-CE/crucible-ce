// Upsert Capability rows from the content library (FEMA core capabilities and
// NIST CSF 2.0) for every framework. Idempotent: safe at setup, in the seed
// script, and lazily before an exercise needs them.

import { db, type DbClient } from "@/lib/db";
import { CAPABILITY_FRAMEWORK_IDS, listCapabilities } from "@/lib/exercise/content/capabilities";

export async function seedCapabilities(client: DbClient = db): Promise<number> {
  let n = 0;
  for (const framework of CAPABILITY_FRAMEWORK_IDS) {
    for (const c of listCapabilities(framework)) {
      await client.capability.upsert({
        where: { framework_key: { framework, key: c.key } },
        create: { framework, key: c.key, name: c.name, description: c.description, seq: c.seq },
        update: { name: c.name, description: c.description, seq: c.seq },
      });
      n++;
    }
  }
  return n;
}

/** Seed once when the table is empty (installs set up before seeding existed). */
export async function ensureCapabilities(client: DbClient = db): Promise<void> {
  if ((await client.capability.count()) > 0) return;
  await seedCapabilities(client);
}
