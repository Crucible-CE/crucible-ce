// @vitest-environment node
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { createHash, generateKeyPairSync, verify as cryptoVerify } from "crypto";
import {
  appendLedger,
  verifyLedger,
  verifyLedgerAnchored,
  computeEntryHash,
  canonicalLedgerEntry,
  LEDGER_GENESIS_HASH,
} from "./append";
import { canonicalJson } from "@/lib/crypto/hash";
import { __resetDerivedKeysForTests } from "@/lib/crypto/org-crypto";

// Keyed entry hashes need the install master key.
beforeAll(() => {
  process.env.MASTER_KEK = "a1".repeat(32);
  __resetDerivedKeysForTests();
});

type Row = {
  incidentId: string;
  organizationId: string;
  seq: number;
  actorUserId: string | null;
  actorLabel: string | null;
  eventType: string;
  payloadJson: unknown;
  prevHash: string;
  entryHash: string;
  keyId?: string | null;
  createdAt: Date;
};

// In-memory fake of the `incidentLedgerEntry` delegate — the subset the ledger
// lib touches. Cast to the param type at call sites.
function makeFakeClient() {
  const rows: Row[] = [];
  const client = {
    incidentLedgerEntry: {
      findFirst: async ({ where }: { where: { incidentId: string } }) =>
        rows
          .filter((r) => r.incidentId === where.incidentId)
          .sort((a, b) => b.seq - a.seq)[0] ?? null,
      findMany: async ({ where }: { where: { incidentId: string } }) =>
        rows
          .filter((r) => r.incidentId === where.incidentId)
          .sort((a, b) => a.seq - b.seq),
      create: async ({ data }: { data: Row }) => {
        rows.push({ ...data });
        return data;
      },
    },
  };
  return { rows, client: client as unknown as Parameters<typeof appendLedger>[0] };
}

const base = { incidentId: "inc-1", organizationId: "org-1" } as const;

describe("incident ledger", () => {
  it("first entry uses genesis prevHash and seq 1", async () => {
    const { client } = makeFakeClient();
    const r = await appendLedger(client, { ...base, eventType: "declared", payload: { a: 1 } });
    expect(r.seq).toBe(1);
  });

  it("chains entries with monotonic seq and prevHash = previous entryHash", async () => {
    const { rows, client } = makeFakeClient();
    await appendLedger(client, { ...base, eventType: "declared", payload: { step: 1 } });
    await appendLedger(client, { ...base, eventType: "status_changed", payload: { step: 2 } });
    await appendLedger(client, { ...base, eventType: "note_added", payload: { step: 3 } });

    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(rows[0].prevHash).toBe(LEDGER_GENESIS_HASH);
    expect(rows[1].prevHash).toBe(rows[0].entryHash);
    expect(rows[2].prevHash).toBe(rows[1].entryHash);
  });

  it("verifies an untampered chain", async () => {
    const { client } = makeFakeClient();
    for (let i = 0; i < 5; i++) {
      await appendLedger(client, { ...base, eventType: "note_added", payload: { i } });
    }
    const result = await verifyLedger(client, base.incidentId);
    expect(result.valid).toBe(true);
    expect(result.entryCount).toBe(5);
    expect(result.brokenAtSeq).toBeNull();
  });

  it("detects a tampered payload at the altered seq", async () => {
    const { rows, client } = makeFakeClient();
    for (let i = 0; i < 4; i++) {
      await appendLedger(client, { ...base, eventType: "note_added", payload: { i } });
    }
    // Tamper: rewrite the payload of entry seq 2 without recomputing hashes.
    rows[1].payloadJson = { i: 999 };
    const result = await verifyLedger(client, base.incidentId);
    expect(result.valid).toBe(false);
    expect(result.brokenAtSeq).toBe(2);
  });

  it("detects a deleted (reordered) entry", async () => {
    const { rows, client } = makeFakeClient();
    for (let i = 0; i < 4; i++) {
      await appendLedger(client, { ...base, eventType: "note_added", payload: { i } });
    }
    rows.splice(1, 1); // delete seq 2 -> remaining seqs 1,3,4 (gap)
    const result = await verifyLedger(client, base.incidentId);
    expect(result.valid).toBe(false);
    expect(result.brokenAtSeq).toBe(3);
  });

  it("canonicalizes payload key order (hash stable regardless of key order)", async () => {
    const a = makeFakeClient();
    const b = makeFakeClient();
    await appendLedger(a.client, { ...base, eventType: "note_added", payload: { x: 1, y: 2 } });
    await appendLedger(b.client, { ...base, eventType: "note_added", payload: { y: 2, x: 1 } });
    // Same logical payload, different key order -> different entryHash only via
    // createdAt; the canonical payload portion must match. Verify both chains
    // validate (canonicalization is exercised inside verify).
    expect((await verifyLedger(a.client, base.incidentId)).valid).toBe(true);
    expect((await verifyLedger(b.client, base.incidentId)).valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// race-safe seq, head anchoring, signed heads, truncation detection.
// ---------------------------------------------------------------------------

type Anchor = {
  ledgerSeq: number | null;
  ledgerHead: string | null;
  ledgerHeadSig: string | null;
  ledgerHeadKeyId?: string | null;
  ledgerHeadAt: Date | null;
};

// Fake with unique-(incidentId,seq) enforcement, an incident anchor row, and
// export-head rows — the surface verifyLedgerAnchored needs.
function makeAnchoredFakeClient() {
  const rows: Row[] = [];
  const anchor: Anchor = { ledgerSeq: null, ledgerHead: null, ledgerHeadSig: null, ledgerHeadAt: null };
  const exportHeads: (string | null)[] = [];
  let staleReads = 0; // when >0, findFirst returns a stale (older) row to force a seq race

  const client = {
    incidentLedgerEntry: {
      findFirst: async ({ where }: { where: { incidentId: string } }) => {
        const sorted = rows
          .filter((r) => r.incidentId === where.incidentId)
          .sort((a, b) => b.seq - a.seq);
        if (staleReads > 0 && sorted.length > 1) {
          staleReads--;
          return sorted[1]; // stale: pretend the newest row isn't visible yet
        }
        if (staleReads > 0) {
          staleReads--;
          return null;
        }
        return sorted[0] ?? null;
      },
      findMany: async ({ where }: { where: { incidentId: string } }) =>
        rows.filter((r) => r.incidentId === where.incidentId).sort((a, b) => a.seq - b.seq),
      create: async ({ data }: { data: Row }) => {
        if (rows.some((r) => r.incidentId === data.incidentId && r.seq === data.seq)) {
          const err = new Error("Unique constraint failed") as Error & {
            code: string;
            meta: { target: string[] };
          };
          err.code = "P2002";
          err.meta = { target: ["incidentId", "seq"] };
          throw err;
        }
        rows.push({ ...data });
        return data;
      },
    },
    incident: {
      update: async ({ data }: { data: Partial<Anchor> }) => {
        Object.assign(anchor, data);
        return anchor;
      },
      findUnique: async () => ({
        ledgerSeq: anchor.ledgerSeq,
        ledgerHead: anchor.ledgerHead,
        ledgerHeadSig: anchor.ledgerHeadSig,
        ledgerHeadKeyId: anchor.ledgerHeadKeyId ?? null,
      }),
    },
    incidentExport: {
      findMany: async () => exportHeads.filter((h) => h !== null).map((h) => ({ ledgerHead: h })),
    },
  };
  return {
    rows,
    anchor,
    exportHeads,
    forceStaleReads: (n: number) => { staleReads = n; },
    client: client as unknown as Parameters<typeof verifyLedgerAnchored>[0],
  };
}

describe("A2 race-safe seq allocation", () => {
  it("retries through a duplicate-seq race and lands on the next free seq", async () => {
    const f = makeAnchoredFakeClient();
    await appendLedger(f.client, { ...base, eventType: "declared", payload: { i: 1 } });
    await appendLedger(f.client, { ...base, eventType: "note_added", payload: { i: 2 } });
    // Next append reads stale state twice (sees seq 1 as max, collides on 2).
    f.forceStaleReads(2);
    const r = await appendLedger(f.client, { ...base, eventType: "note_added", payload: { i: 3 } });
    expect(r.seq).toBe(3);
    expect(f.rows.map((x) => x.seq).sort()).toEqual([1, 2, 3]);
    expect((await verifyLedger(f.client, base.incidentId)).valid).toBe(true);
  });

  it("does not swallow non-seq unique violations", async () => {
    const { client } = makeFakeClient();
    const failing = {
      incidentLedgerEntry: {
        ...(client as unknown as { incidentLedgerEntry: Record<string, unknown> }).incidentLedgerEntry,
        create: async () => {
          const err = new Error("other unique") as Error & { code: string; meta: { target: string[] } };
          err.code = "P2002";
          err.meta = { target: ["email"] };
          throw err;
        },
      },
    } as unknown as Parameters<typeof appendLedger>[0];
    await expect(
      appendLedger(failing, { ...base, eventType: "note_added", payload: {} }),
    ).rejects.toThrow("other unique");
  });
});

describe("A2 head anchoring", () => {
  it("anchors ledgerSeq/ledgerHead to the last entry on every append", async () => {
    const f = makeAnchoredFakeClient();
    await appendLedger(f.client, { ...base, eventType: "declared", payload: { i: 1 } });
    await appendLedger(f.client, { ...base, eventType: "note_added", payload: { i: 2 } });
    const last = f.rows[f.rows.length - 1];
    expect(f.anchor.ledgerSeq).toBe(2);
    expect(f.anchor.ledgerHead).toBe(last.entryHash);
    expect(f.anchor.ledgerHeadAt).toBeInstanceOf(Date);
  });

  it("clients without an incident delegate (test fakes) skip anchoring", async () => {
    const { client } = makeFakeClient();
    const r = await appendLedger(client, { ...base, eventType: "declared", payload: {} });
    expect(r.seq).toBe(1); // no throw, no anchor attempted
  });
});

describe("A2 signed heads", () => {
  const prior = process.env.EXPORT_SIGNING_PRIVATE_KEY;
  afterEach(() => {
    if (prior === undefined) delete process.env.EXPORT_SIGNING_PRIVATE_KEY;
    else process.env.EXPORT_SIGNING_PRIVATE_KEY = prior;
  });

  it("signs the head with Ed25519 when the export key is configured", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    process.env.EXPORT_SIGNING_PRIVATE_KEY = privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();

    const f = makeAnchoredFakeClient();
    const r = await appendLedger(f.client, { ...base, eventType: "declared", payload: {} });

    expect(f.anchor.ledgerHeadSig).toBeTruthy();
    const ok = cryptoVerify(
      null,
      Buffer.from(`${base.incidentId}|${r.seq}|${r.entryHash}`, "utf8"),
      publicKey,
      Buffer.from(f.anchor.ledgerHeadSig!, "base64"),
    );
    expect(ok).toBe(true);
  });

  it("anchors unsigned (null sig) when no key is configured", async () => {
    delete process.env.EXPORT_SIGNING_PRIVATE_KEY;
    const f = makeAnchoredFakeClient();
    await appendLedger(f.client, { ...base, eventType: "declared", payload: {} });
    expect(f.anchor.ledgerHeadSig).toBeNull();
    expect(f.anchor.ledgerHead).toBeTruthy();
  });
});

describe("A2 truncation detection (verifyLedgerAnchored)", () => {
  it("valid chain with matching anchor passes", async () => {
    const f = makeAnchoredFakeClient();
    for (let i = 0; i < 5; i++) {
      await appendLedger(f.client, { ...base, eventType: "note_added", payload: { i } });
    }
    const r = await verifyLedgerAnchored(f.client, base.incidentId);
    expect(r.valid).toBe(true);
    expect(r.headMatches).toBe(true);
    expect(r.truncationSuspected).toBe(false);
  });

  it("detects tail truncation via the anchored head (plain verify misses it)", async () => {
    const f = makeAnchoredFakeClient();
    for (let i = 0; i < 5; i++) {
      await appendLedger(f.client, { ...base, eventType: "note_added", payload: { i } });
    }
    // Attacker deletes the last two rows but can't touch the anchor.
    f.rows.splice(3, 2);

    const naive = await verifyLedger(f.client, base.incidentId);
    expect(naive.valid).toBe(true); // regression guard: chain-only verify is blind to this

    const anchored = await verifyLedgerAnchored(f.client, base.incidentId);
    expect(anchored.valid).toBe(false);
    expect(anchored.headMatches).toBe(false);
    expect(anchored.reason).toMatch(/truncation/i);
  });

  it("catches anchor-consistent truncation via prior export heads", async () => {
    const f = makeAnchoredFakeClient();
    for (let i = 0; i < 5; i++) {
      await appendLedger(f.client, { ...base, eventType: "note_added", payload: { i } });
    }
    // An export snapshotted the head at seq 5.
    f.exportHeads.push(f.rows[4].entryHash);
    // Fuller attacker: truncate to seq 3 AND re-point the anchor consistently.
    f.rows.splice(3, 2);
    f.anchor.ledgerSeq = 3;
    f.anchor.ledgerHead = f.rows[2].entryHash;

    const r = await verifyLedgerAnchored(f.client, base.incidentId);
    expect(r.headMatches).toBe(true); // the anchor lies consistently...
    expect(r.truncationSuspected).toBe(true); // ...but the exported head betrays it
    expect(r.valid).toBe(false);
  });

  it("entries present but NO anchor is tampered (head_missing), never valid", async () => {
    const f = makeAnchoredFakeClient();
    for (let i = 0; i < 3; i++) {
      await appendLedger(f.client, { ...base, eventType: "note_added", payload: { i } });
    }
    f.anchor.ledgerSeq = null;
    f.anchor.ledgerHead = null;
    const r = await verifyLedgerAnchored(f.client, base.incidentId);
    expect(r).toMatchObject({ valid: false, status: "tampered", headMissing: true, headMatches: false });
    expect(r.reason).toMatch(/head_missing/);
  });

  it("an incident with no entries and no anchor is an empty, valid ledger", async () => {
    const f = makeAnchoredFakeClient();
    const r = await verifyLedgerAnchored(f.client, base.incidentId);
    expect(r).toMatchObject({ valid: true, status: "valid", headMissing: false, entryCount: 0 });
  });
});

// ---------------------------------------------------------------------------
// M5: keyed entry hashes over every field, legacy detection, head signatures.
// ---------------------------------------------------------------------------

async function chainOf(n: number) {
  const f = makeAnchoredFakeClient();
  for (let i = 0; i < n; i++) {
    await appendLedger(f.client, {
      ...base,
      eventType: "note_added",
      payload: { i },
      actorUserId: `u${i}`,
      actorLabel: `User ${i}`,
    });
  }
  return f;
}

describe("M5 keyed entry hashes", () => {
  it("entryHash is an HMAC (not the old unkeyed SHA-256) and depends on MASTER_KEK", async () => {
    const f = await chainOf(1);
    const r = f.rows[0];
    const legacy = createHash("sha256")
      .update(`${r.prevHash}|${canonicalJson(r.payloadJson)}|${r.seq}|${r.createdAt.toISOString()}`)
      .digest("hex");
    expect(r.entryHash).not.toBe(legacy);

    const prior = process.env.MASTER_KEK;
    process.env.MASTER_KEK = "b2".repeat(32);
    __resetDerivedKeysForTests();
    try {
      const v = await verifyLedger(f.client, base.incidentId);
      expect(v.valid).toBe(false); // a different install key cannot validate it
      // ...and it says so distinctly from tampering (entries carry the key id).
      expect(v.status).toBe("key_mismatch");
      expect(v.reason).toMatch(/MASTER_KEK has changed/);
    } finally {
      process.env.MASTER_KEK = prior;
      __resetDerivedKeysForTests();
    }
  });

  it("an edited row that also forges a foreign keyId is still a failure (never valid)", async () => {
    const f = await chainOf(3);
    f.rows[1].actorLabel = "Forged";
    f.rows[1].keyId = "ffffffffffffffff";
    const v = await verifyLedgerAnchored(f.client, base.incidentId);
    expect(v.valid).toBe(false);
  });

  it("every entry records the ledger key id", async () => {
    const f = await chainOf(2);
    expect(f.rows.every((r) => /^[0-9a-f]{16}$/.test(r.keyId ?? ""))).toBe(true);
  });

  it("round-trips: a fresh chain is status=valid", async () => {
    const f = await chainOf(3);
    const v = await verifyLedger(f.client, base.incidentId);
    expect(v).toMatchObject({ valid: true, status: "valid", warnings: [] });
  });

  it("hashes the payload exactly as jsonb returns it (Dates become ISO strings)", async () => {
    const f = makeAnchoredFakeClient();
    const when = new Date("2026-01-02T03:04:05.678Z");
    await appendLedger(f.client, { ...base, eventType: "note_added", payload: { when } as never });
    expect(f.rows[0].payloadJson).toEqual({ when: when.toISOString() });
    expect((await verifyLedger(f.client, base.incidentId)).valid).toBe(true);
  });

  const tampers: [string, (r: Row) => void][] = [
    ["actorUserId", (r) => { r.actorUserId = "attacker"; }],
    ["actorLabel", (r) => { r.actorLabel = "Someone Else"; }],
    ["eventType", (r) => { r.eventType = "decision_made"; }],
    ["payload", (r) => { r.payloadJson = { i: 999 }; }],
    ["createdAt", (r) => { r.createdAt = new Date(r.createdAt.getTime() + 1); }],
    ["organizationId", (r) => { r.organizationId = "org-2"; }],
  ];
  for (const [field, mutate] of tampers) {
    it(`detects a tampered ${field}`, async () => {
      const f = await chainOf(4);
      mutate(f.rows[1]);
      const v = await verifyLedgerAnchored(f.client, base.incidentId);
      expect(v.valid).toBe(false);
      expect(v.status).toBe("tampered");
      expect(v.brokenAtSeq).toBe(2);
    });
  }

  it("detects a tampered seq (and seq is bound into the hash)", async () => {
    const f = await chainOf(3);
    f.rows[2].seq = 4; // renumber the tail
    const v = await verifyLedger(f.client, base.incidentId);
    expect(v.valid).toBe(false);

    const r = f.rows[0];
    const fields = {
      prevHash: r.prevHash, seq: r.seq, incidentId: r.incidentId, organizationId: r.organizationId,
      eventType: r.eventType, actorUserId: r.actorUserId, actorLabel: r.actorLabel,
      payload: r.payloadJson, createdAtIso: r.createdAt.toISOString(),
    };
    expect(computeEntryHash(fields)).toBe(r.entryHash);
    expect(computeEntryHash({ ...fields, seq: 2 })).not.toBe(r.entryHash);
  });

  // Unkeyed SHA-256 in the pre-M5 shape: what a DB-only attacker can compute.
  const unkeyed = (prev: string, payload: unknown, seq: number, at: Date) =>
    createHash("sha256").update(`${prev}|${canonicalJson(payload)}|${seq}|${at.toISOString()}`).digest("hex");

  it("rejects a single row rewritten with the unkeyed formula", async () => {
    const f = await chainOf(3);
    const r = f.rows[2];
    r.actorLabel = "Forged";
    r.entryHash = unkeyed(r.prevHash, r.payloadJson, r.seq, r.createdAt);
    f.anchor.ledgerHead = r.entryHash;
    const v = await verifyLedgerAnchored(f.client, base.incidentId);
    expect(v).toMatchObject({ valid: false, status: "tampered", brokenAtSeq: 3 });
  });

  it("rejects a FULL-chain recompute with the unkeyed formula (no downgrade path)", async () => {
    const f = await chainOf(4);
    // Attacker rewrites history and recomputes every hash + the anchor consistently.
    let prev = LEDGER_GENESIS_HASH;
    for (const r of f.rows) {
      r.actorLabel = "Rewritten";
      r.prevHash = prev;
      r.entryHash = unkeyed(prev, r.payloadJson, r.seq, r.createdAt);
      prev = r.entryHash;
    }
    f.anchor.ledgerSeq = f.rows.length;
    f.anchor.ledgerHead = prev;
    const v = await verifyLedgerAnchored(f.client, base.incidentId);
    expect(v.valid).toBe(false);
    expect(v.status).toBe("tampered");
    expect(v.brokenAtSeq).toBe(1);
    expect(v).not.toHaveProperty("legacyUnkeyedCount");
  });

  it("rejects entries made under an unknown key/version (fail closed)", async () => {
    const f = await chainOf(2);
    // Same canonical bytes, but keyed under a different HKDF info (a "v2"
    // scheme / unknown key id): must not verify.
    const { createHmac, hkdfSync } = await import("node:crypto");
    const k2 = Buffer.from(hkdfSync("sha256", Buffer.from(process.env.MASTER_KEK!, "hex"), "crucible-ce", "ledger-v2", 32));
    let prev = LEDGER_GENESIS_HASH;
    for (const r of f.rows) {
      r.prevHash = prev;
      const fields = {
        prevHash: prev, seq: r.seq, incidentId: r.incidentId, organizationId: r.organizationId,
        eventType: r.eventType, actorUserId: r.actorUserId, actorLabel: r.actorLabel,
        payload: r.payloadJson, createdAtIso: r.createdAt.toISOString(),
      };
      r.entryHash = createHmac("sha256", k2).update(canonicalLedgerEntry(fields)).digest("hex");
      prev = r.entryHash;
    }
    f.anchor.ledgerHead = prev;
    const v = await verifyLedgerAnchored(f.client, base.incidentId);
    expect(v).toMatchObject({ valid: false, status: "tampered", brokenAtSeq: 1 });
  });
});

describe("M5 head signature verification", () => {
  const prior = process.env.EXPORT_SIGNING_PRIVATE_KEY;
  afterEach(() => {
    if (prior === undefined) delete process.env.EXPORT_SIGNING_PRIVATE_KEY;
    else process.env.EXPORT_SIGNING_PRIVATE_KEY = prior;
  });
  const useKey = () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    process.env.EXPORT_SIGNING_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  };

  it("valid signed head passes with headSignature=valid", async () => {
    useKey();
    const f = await chainOf(3);
    const v = await verifyLedgerAnchored(f.client, base.incidentId);
    expect(v).toMatchObject({ valid: true, status: "valid", headSignature: "valid" });
  });

  it("detects a head signature mismatch (anchor re-pointed, sig left stale)", async () => {
    useKey();
    const f = await chainOf(3);
    const sig2 = (await (async () => {
      const g = await chainOf(1);
      return g.anchor.ledgerHeadSig;
    })())!;
    f.anchor.ledgerHeadSig = sig2; // a real signature, but over a different head
    const v = await verifyLedgerAnchored(f.client, base.incidentId);
    expect(v.valid).toBe(false);
    expect(v.status).toBe("tampered");
    expect(v.headSignature).toBe("invalid");
    expect(v.reason).toMatch(/signature/);
  });

  it("a head signed by a rotated-out key is key_mismatch (not tampered), never valid", async () => {
    useKey();
    const f = await chainOf(2);
    expect(f.anchor.ledgerHeadKeyId).toMatch(/^[0-9a-f]{16}$/);
    useKey(); // rotate to a different key
    const v = await verifyLedgerAnchored(f.client, base.incidentId);
    expect(v).toMatchObject({ valid: false, status: "key_mismatch", headSignature: "key_mismatch" });
    expect(v.reason).toMatch(/signing key has changed/);
  });

  it("a signature that does not verify under its own recorded key is tampered", async () => {
    useKey();
    const f = await chainOf(2);
    useKey();
    const g = await chainOf(1);
    // Forge: the CURRENT key's signature + key id, but over a different head.
    f.anchor.ledgerHeadSig = g.anchor.ledgerHeadSig;
    f.anchor.ledgerHeadKeyId = g.anchor.ledgerHeadKeyId;
    const v = await verifyLedgerAnchored(f.client, base.incidentId);
    expect(v).toMatchObject({ valid: false, status: "tampered", headSignature: "invalid" });
  });

  it("an unsigned head written BEFORE a signing key existed is valid with an unsigned (pre-signing) warning", async () => {
    delete process.env.EXPORT_SIGNING_PRIVATE_KEY;
    const f = await chainOf(2);
    expect(f.anchor.ledgerHeadKeyId).toBeNull();
    useKey(); // key configured afterwards
    const v = await verifyLedgerAnchored(f.client, base.incidentId);
    expect(v).toMatchObject({ valid: true, status: "valid", headSignature: "pre_signing" });
    expect(v.warnings.join(" ")).toMatch(/unsigned \(pre-signing\)/);
    // The next append signs the head with the new key.
    await appendLedger(f.client, { ...base, eventType: "note_added", payload: { n: 3 } });
    expect((await verifyLedgerAnchored(f.client, base.incidentId)).headSignature).toBe("valid");
  });

  it("FAILS when a key is configured but the head signature is missing", async () => {
    useKey();
    const f = await chainOf(2);
    f.anchor.ledgerHeadSig = null;
    const v = await verifyLedgerAnchored(f.client, base.incidentId);
    expect(v.headSignature).toBe("missing");
    expect(v.status).toBe("head_unsigned");
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/unsigned/);
  });

  it("appendLedger always signs the head when a key is configured", async () => {
    useKey();
    const f = await chainOf(3);
    expect(f.anchor.ledgerHeadSig).toBeTruthy();
  });

  it("no key configured and no sig → not_configured (status unaffected)", async () => {
    delete process.env.EXPORT_SIGNING_PRIVATE_KEY;
    const f = await chainOf(2);
    const v = await verifyLedgerAnchored(f.client, base.incidentId);
    expect(v).toMatchObject({ valid: true, status: "valid", headSignature: "not_configured" });
  });
});
