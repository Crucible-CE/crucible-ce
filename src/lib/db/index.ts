import { PrismaClient, type Prisma } from "@prisma/client";

/** A transaction client, as passed to interactive $transaction callbacks. */
export type Tx = Prisma.TransactionClient;

/** Either the root client or a transaction client. */
export type DbClient = Tx | PrismaClient;

// Append connection-pool tuning params to DATABASE_URL so Prisma doesn't
// issue an unbounded number of Postgres connections. Without this, a single
// container can hit the Postgres max_connections cap; when the
// container is recycled, every connection is torn down simultaneously,
// producing the "SSL error: unexpected eof" / "Connection reset by peer"
// burst pattern seen in the Postgres logs and hanging /api/auth/session.
//
// Values can be overridden via env: PRISMA_CONNECTION_LIMIT, PRISMA_POOL_TIMEOUT.
function buildDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Malformed URL — let Prisma surface the real error
    return raw;
  }

  const connectionLimit = process.env.PRISMA_CONNECTION_LIMIT ?? "15";
  const poolTimeout = process.env.PRISMA_POOL_TIMEOUT ?? "5";

  if (!url.searchParams.has("connection_limit")) {
    url.searchParams.set("connection_limit", connectionLimit);
  }
  if (!url.searchParams.has("pool_timeout")) {
    url.searchParams.set("pool_timeout", poolTimeout);
  }
  return url.toString();
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const tunedUrl = buildDatabaseUrl();

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
    ...(tunedUrl ? { datasources: { db: { url: tunedUrl } } } : {}),
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
