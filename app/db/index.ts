import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "file:./data/app.db";

// libSQL creates the DB file but not its parent directory; ensure it exists.
if (url.startsWith("file:")) {
  const dir = url.slice("file:".length).replace(/\/[^/]*$/, "");
  if (dir) mkdirSync(dir, { recursive: true });
}

const client = createClient({ url });

export const db = drizzle(client, { schema });

let ready: Promise<void> | undefined;

/**
 * Idempotently bring the database up to the current schema by applying the
 * generated Drizzle migrations in `drizzle/` — `schema.ts` is the single source
 * of truth (regenerate with `bun run db:generate`). Safe to call on every request:
 * the migrator records applied migrations in `__drizzle_migrations` and skips them.
 */
export function ensureSchema(): Promise<void> {
  ready ??= migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });
  return ready;
}
