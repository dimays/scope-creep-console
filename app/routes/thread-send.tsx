import { threadReplyStream } from "~/lib/threads.server";
import type { Route } from "./+types/thread-send";

/**
 * Resource route (action only) — the Chief of Staff's live reply turn (ADR-013).
 * Returns a streaming text/plain Response so the thread renders the reply token-by-token
 * with no browser refresh. The data layer persists both messages and flips the turn.
 */
export async function action({ request }: Route.ActionArgs) {
  const { threadId, text } = (await request.json()) as { threadId?: unknown; text?: unknown };
  const id = Number(threadId);
  const clean = String(text ?? "")
    .trim()
    .slice(0, 5000);
  if (!id || !clean) return Response.json({ error: "empty" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const delta of threadReplyStream(id, clean)) {
          controller.enqueue(encoder.encode(delta));
        }
      } catch {
        // The data layer already degrades to a batched chunk; a hard failure here just
        // ends the stream — the client falls back to revalidating the persisted thread.
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
