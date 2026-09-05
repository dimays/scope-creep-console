import { db, ensureSchema } from "~/db";
import { pageVisits } from "~/db/schema";
import { APP_VERSION } from "~/lib/version";

/**
 * Resource route (loader only, no component). The App Contract's `healthcheck`
 * target: machine-readable liveness + version + dependency status.
 */
export async function loader() {
  let dbOk = false;
  try {
    await ensureSchema();
    await db.select().from(pageVisits).limit(1);
    dbOk = true;
  } catch {
    dbOk = false;
  }

  return Response.json(
    { status: dbOk ? "ok" : "degraded", version: APP_VERSION, db: dbOk },
    { status: dbOk ? 200 : 503 },
  );
}
