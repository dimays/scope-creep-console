import { desc, eq } from "drizzle-orm";
import { db, ensureSchema } from "~/db";
import { conversationMessages, conversations } from "~/db/schema";
import { type AgentMessage, agentRespondStream } from "./agent.server";
import { effectiveChatModel } from "./models.server";
import type { MessageMeta, Thread, ThreadMessage, ThreadStatus } from "./threads";

/**
 * CoS-Threads data layer (work-029, ADR-012). A **thread** is a `conversation`; its
 * timeline is `conversation_messages` (plain `message` rows + typed `outcome` cards).
 * This unifies the old Chat + Work Requests surfaces onto one model. The Chief of Staff
 * replies live via `threadReplyStream` (ADR-013 streaming turn); async operator triage
 * still layers typed `outcome` cards on top. Pure types + `parseMeta` live in the
 * client-safe ./threads module.
 */

export type {
  MessageMeta,
  Thread,
  ThreadInitiator,
  ThreadMessage,
  ThreadStatus,
} from "./threads";

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
    .values({ kind, title, status: "working", initiator: "owner", createdAt: now, updatedAt: now })
    .returning();
  await db
    .insert(conversationMessages)
    .values({ conversationId: row.id, role: "owner", type: "message", body, at: now });
  return row;
}

type OrgThreadOpts = {
  /** Author label for the opener card (default `chief-of-staff`). */
  author?: string;
  kind?: string;
  /** Override the starting turn; defaults to `needs-you` (parked on the Owner). */
  status?: ThreadStatus;
};

/**
 * The Chief of Staff opens a thread when the org needs the Owner's input (work-030) —
 * giving the org a voice, not only the Owner. It's `initiator: "org"` and parked on the
 * Owner (`needs-you`) from the start, so it lands in his needs-you queue. The opener is an
 * `agent` message, so a CoS-initiated thread is an org→Owner event that never pollutes the
 * Human-Input Log (which unions only `role = owner`). Built on the existing conversation
 * primitive — no reshape.
 */
export async function createOrgThread(
  title: string,
  body: string,
  opts: OrgThreadOpts = {},
): Promise<Thread> {
  await ensureSchema();
  const now = Date.now();
  const [row] = await db
    .insert(conversations)
    .values({
      kind: opts.kind ?? "request",
      title,
      status: opts.status ?? "needs-you",
      initiator: "org",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await db.insert(conversationMessages).values({
    conversationId: row.id,
    role: "agent",
    type: "message",
    body,
    meta: JSON.stringify({ author: opts.author ?? "chief-of-staff" }),
    at: now,
  });
  return row;
}

/**
 * The Chief of Staff posts a followup on an existing thread and hands the turn back to the
 * Owner (`needs-you` by default) — the other half of a CoS voice (work-030). A closed
 * thread is thereby reopened onto the Owner's queue. Delegates to `addMessage` so the
 * turn-flip and `updatedAt` touch stay in one place.
 */
export async function orgFollowup(
  threadId: number,
  body: string,
  opts: { author?: string; status?: ThreadStatus } = {},
): Promise<void> {
  await addMessage(threadId, "agent", body, {
    status: opts.status ?? "needs-you",
    meta: { author: opts.author ?? "chief-of-staff" },
  });
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

/** Prior plain-text turns for the agent's context (typed outcome cards are excluded). */
async function threadHistory(threadId: number): Promise<AgentMessage[]> {
  const rows = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, threadId))
    .orderBy(conversationMessages.at);
  return rows
    .filter((r) => r.type === "message")
    .map((r) => ({ role: r.role === "owner" ? "owner" : "agent", body: r.body }) as AgentMessage);
}

/**
 * The Chief of Staff's live reply turn (ADR-013). Persists the Owner's message
 * (flipping the turn to `working`), streams the CoS reply token-by-token to the caller,
 * then persists the full reply and flips the turn back to the Owner (`needs-you`). The
 * stream degrades to a single chunk with no API key or on error — batched is the floor.
 */
export async function* threadReplyStream(
  threadId: number,
  userText: string,
): AsyncGenerator<string, void, unknown> {
  await ensureSchema();
  const history = await threadHistory(threadId);
  await addMessage(threadId, "owner", userText); // persists + flips turn to `working`
  const model = await effectiveChatModel();
  let full = "";
  for await (const delta of agentRespondStream(history, userText, { model })) {
    full += delta;
    yield delta;
  }
  await addMessage(threadId, "agent", full.trim() || "(no reply)", {
    status: "needs-you",
    meta: { author: "chief-of-staff" },
  });
}
