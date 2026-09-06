import { desc, eq } from "drizzle-orm";
import { db, ensureSchema } from "~/db";
import { conversationMessages, conversations } from "~/db/schema";
import type { MessageMeta, Thread, ThreadMessage, ThreadStatus } from "./threads";

/**
 * CoS-Threads data layer (work-029, ADR-012). A **thread** is a `conversation`; its
 * timeline is `conversation_messages` (plain `message` rows + typed `outcome` cards).
 * This unifies the old Chat + Work Requests surfaces onto one model. Triage stays async
 * in the operator session (today's work-009 mechanism) — no agent runtime here; the live
 * agent chat turn still lives in conversation.server.ts. Pure types + `parseMeta` live in
 * the client-safe ./threads module.
 */

export type { MessageMeta, Thread, ThreadMessage, ThreadStatus } from "./threads";

/** All threads, most-recently-updated first (both `chat` and `request` kinds). */
export async function listThreads(): Promise<Thread[]> {
  await ensureSchema();
  return db.select().from(conversations).orderBy(desc(conversations.updatedAt));
}

export async function getThread(
  id: number,
): Promise<{ thread: Thread; messages: ThreadMessage[] } | null> {
  await ensureSchema();
  const [thread] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!thread) return null;
  const messages = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, id))
    .orderBy(conversationMessages.at);
  return { thread, messages };
}

/** The Owner opens a thread (an ask/tell). Status starts `working` — the org's turn. */
export async function createThread(title: string, body: string, kind = "request"): Promise<Thread> {
  await ensureSchema();
  const now = Date.now();
  const [row] = await db
    .insert(conversations)
    .values({ kind, title, status: "working", createdAt: now, updatedAt: now })
    .returning();
  await db
    .insert(conversationMessages)
    .values({ conversationId: row.id, role: "owner", type: "message", body, at: now });
  return row;
}

type AddOpts = {
  type?: string;
  status?: ThreadStatus;
  meta?: MessageMeta;
};

/**
 * Append an item to a thread and touch its `updatedAt`. Owner replies flip the turn to
 * `working` (the org's court) unless the caller sets an explicit status or the thread is
 * closed; an operator/org reply typically sets `needs-you` or `closed`.
 */
export async function addMessage(
  threadId: number,
  role: string,
  body: string,
  opts: AddOpts = {},
): Promise<void> {
  await ensureSchema();
  const now = Date.now();
  await db.insert(conversationMessages).values({
    conversationId: threadId,
    role,
    type: opts.type ?? "message",
    body,
    meta: opts.meta ? JSON.stringify(opts.meta) : null,
    at: now,
  });
  const patch: { updatedAt: number; status?: string } = { updatedAt: now };
  if (opts.status) patch.status = opts.status;
  else if (role === "owner") patch.status = "working";
  await db.update(conversations).set(patch).where(eq(conversations.id, threadId));
}

/** Set a thread's lifecycle/turn without adding a message. */
export async function setStatus(threadId: number, status: ThreadStatus): Promise<void> {
  await ensureSchema();
  await db
    .update(conversations)
    .set({ status, updatedAt: Date.now() })
    .where(eq(conversations.id, threadId));
}
