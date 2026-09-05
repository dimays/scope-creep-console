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
  ready ??= (async () => {
    await client.execute(
      `CREATE TABLE IF NOT EXISTS page_visits (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         path TEXT NOT NULL,
         at INTEGER NOT NULL
       )`,
    );
    await client.execute(
      `CREATE TABLE IF NOT EXISTS feedback (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         context_key TEXT NOT NULL,
         rating TEXT NOT NULL,
         comment TEXT NOT NULL DEFAULT '',
         at INTEGER NOT NULL
       )`,
    );
    await client.execute(
      `CREATE TABLE IF NOT EXISTS requests (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         title TEXT NOT NULL,
         status TEXT NOT NULL DEFAULT 'open',
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`,
    );
    await client.execute(
      `CREATE TABLE IF NOT EXISTS request_messages (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         request_id INTEGER NOT NULL,
         author TEXT NOT NULL,
         body TEXT NOT NULL,
         at INTEGER NOT NULL
       )`,
    );
    await client.execute(
      `CREATE TABLE IF NOT EXISTS conversations (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         kind TEXT NOT NULL,
         title TEXT NOT NULL DEFAULT '',
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`,
    );
    await client.execute(
      `CREATE TABLE IF NOT EXISTS conversation_messages (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         conversation_id INTEGER NOT NULL,
         role TEXT NOT NULL,
         body TEXT NOT NULL,
         at INTEGER NOT NULL
       )`,
    );
  })();
  return ready;
}
