// GET /api/settings/signing-keys                      facilitators and admins: {current, keys: [{keyId, createdAt, retiredAt, current}]}
// GET /api/settings/signing-keys?keyId=<id>&format=pem  the public key file for that key
// Public keys only. Third parties pin bundles to these key IDs (scripts/verify-bundle.ts --key).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/exercise/auth/session";
import { fileResponse } from "@/lib/http/file-response";
import { withErrors } from "@/lib/exercise/errors";
import { ensureSigningKey, readSigningKey } from "@/lib/exercise/aar/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await requirePermission("reports.view");
  if (!a.ok) return a.response;
  return withErrors(async () => {
    const url = new URL(req.url);
    const keyId = url.searchParams.get("keyId");
    let current: string | null = null;
    try {
      current = readSigningKey()?.keyId ?? null;
      // The export signing key comes from the environment: register it so it is listed before its first signature.
      if (current) await ensureSigningKey(db);
    } catch {
      current = null;
    }
    if (keyId) {
      if (!/^[a-f0-9]{16}$/.test(keyId)) return NextResponse.json({ error: "That key ID is not valid." }, { status: 400 });
      const row = await db.signingKey.findUnique({ where: { keyId }, select: { publicKeyPem: true } });
      if (!row) return NextResponse.json({ error: "Key not found." }, { status: 404 });
      return fileResponse(Buffer.from(row.publicKeyPem, "utf8"), {
        filename: `crucible-signing-key-${keyId}.pem`,
        contentType: "application/x-pem-file",
        trustedContentType: true,
      });
    }
    const rows = await db.signingKey.findMany({ orderBy: { createdAt: "desc" }, select: { keyId: true, createdAt: true, retiredAt: true } });
    return NextResponse.json(
      {
        current,
        keys: rows.map((r) => ({ keyId: r.keyId, createdAt: r.createdAt.toISOString(), retiredAt: r.retiredAt?.toISOString() ?? null, current: r.keyId === current })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
