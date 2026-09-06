import { eq } from "drizzle-orm";
import { db, ensureSchema } from "~/db";
import { settings } from "~/db/schema";

/**
 * Persisted Console settings (work-018) — a thin key/value layer over the `settings`
 * table. Single-user by invariant, so keys are global. First consumer: the Owner's
 * picked chat model (see `models.server.ts`).
 */

/** Read a setting's value, or null if unset. */
export async function getSetting(key: string): Promise<string | null> {
  await ensureSchema();
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return row?.value ?? null;
}

/** Upsert a setting. */
export async function setSetting(key: string, value: string): Promise<void> {
  await ensureSchema();
  await db
    .insert(settings)
    .values({ key, value, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: Date.now() } });
}
