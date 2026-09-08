import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { resolveDbConfig } from "./config";
import * as schema from "./schema";

// Resolve the connection from the environment (work-065, ADR-024): a local `file:` db by
// default, or a hosted `libsql://…` endpoint + scoped `DATABASE_AUTH_TOKEN` in the console's
// deploy environment. resolveDbConfig throws loudly if a remote url arrives without its token
// rather than falling back to a silently-empty local db.
const config = resolveDbConfig();

// libSQL creates the DB file but not its parent directory; ensure it exists (local only).
if (config.url.startsWith("file:")) {
  const dir = config.url.slice("file:".length).replace(/\/[^/]*$/, "");
  if (dir) mkdirSync(dir, { recursive: true });
}

const client = createClient(
  config.remote ? { url: config.url, authToken: config.authToken } : { url: config.url },
);

export const db = drizzle(client, { schema });

/** Whether this process is talking to a remote libSQL endpoint (vs. a local file/in-memory db). */
export const isRemote = config.remote;

/** Raised when the store — a remote libSQL endpoint especially — can't be reached or migrated. */
export class ThreadStoreUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      isRemote
        ? "The remote thread store is unreachable. This is an outage, not an empty store — " +
            "do not treat it as zero threads (ADR-024 honest degradation)."
        : "The local thread store could not be opened.",
      { cause },
    );
    this.name = "ThreadStoreUnavailableError";
  }
}

let ready: Promise<void> | undefined;

/**
 * Idempotently bring the database up to the current schema by applying the generated Drizzle
 * migrations in `drizzle/` — `schema.ts` is the single source of truth (regenerate with
 * `bun run db:generate`). Safe to call on every request: the migrator records applied
 * migrations in `__drizzle_migrations` and skips them. The same runtime migration path serves
 * a remote libSQL endpoint (ADR-024) — no separate deploy-time step.
 *
 * **Honest degradation (ADR-024):** a failure is NOT memoized. If the remote is briefly
 * unreachable the rejected promise is cleared so the next request retries — and the error is
 * wrapped as {@link ThreadStoreUnavailableError} so callers/boundaries surface an outage
 * instead of a raw driver stack or, worse, an empty list.
 */
export function ensureSchema(): Promise<void> {
  ready ??= migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") }).catch((err) => {
    ready = undefined; // don't cache the failure — a transient outage must be retryable
    throw new ThreadStoreUnavailableError(err);
  });
  return ready;
}
