import { join } from "node:path";
import { createClient } from "@libsql/client";
import { getTableName, is, Table } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { describe, expect, it } from "vitest";
import * as schema from "./schema";

describe("schema migrations", () => {
  it("every table declared in schema.ts exists after migrating a fresh db", async () => {
    // A throwaway in-memory db built the way bootstrap builds a real one: by
    // applying the generated migrations. This is the guard against schema.ts and
    // the applied schema drifting apart.
    const client = createClient({ url: ":memory:" });
    await migrate(drizzle(client), { migrationsFolder: join(process.cwd(), "drizzle") });

    const res = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table'");
    const present = new Set(res.rows.map((r) => String(r.name)));

    const declared = Object.values(schema)
      .filter((v) => is(v, Table))
      .map((v) => getTableName(v as Table));

    expect(declared.length).toBeGreaterThanOrEqual(6);
    for (const name of declared) {
      expect(present.has(name), `table '${name}' missing after migrate`).toBe(true);
    }
  });
});
