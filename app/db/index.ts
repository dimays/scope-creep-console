import { mkdirSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
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
 * Idempotently ensure the v0.1 schema exists. Stands in for drizzle-kit
 * migrations while the schema is a single seed table; replaced by generated
 * migrations (`bun run db:generate` / `db:migrate`) once it grows.
 */
export function ensureSchema(): Promise<void> {
  ready ??= client
    .execute(
      `CREATE TABLE IF NOT EXISTS page_visits (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         path TEXT NOT NULL,
         at INTEGER NOT NULL
       )`,
    )
    .then(() => undefined);
  return ready;
}
