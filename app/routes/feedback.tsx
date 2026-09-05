import { db, ensureSchema } from "~/db";
import { feedback } from "~/db/schema";
import type { Route } from "./+types/feedback";

/**
 * Resource route: the host-side persistence the feedback extension posts to.
 * The extension stays storage-agnostic; the Console writes to its own DB.
 */
export async function action({ request }: Route.ActionArgs) {
  const body = (await request.json()) as {
    contextKey?: unknown;
    rating?: unknown;
    comment?: unknown;
  };
  const rating = body.rating === "up" || body.rating === "down" ? body.rating : null;
  if (!rating) return Response.json({ ok: false, error: "invalid rating" }, { status: 400 });

  await ensureSchema();
  await db.insert(feedback).values({
    contextKey: String(body.contextKey ?? "").slice(0, 200),
    rating,
    comment: String(body.comment ?? "").slice(0, 2000),
    at: Date.now(),
  });
  return Response.json({ ok: true });
}
