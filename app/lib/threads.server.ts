import { desc, eq } from "drizzle-orm";
import { db, ensureSchema } from "~/db";
import { conversationMessages, conversations } from "~/db/schema";
import { type AgentMessage, agentRespondStream } from "./agent.server";
import { effectiveChatModel } from "./models.server";
import type { BranchLink, MessageMeta, Thread, ThreadMessage, ThreadStatus } from "./threads";

/**
 * CoS-Threads data layer (work-029, ADR-012). A **thread** is a `conversation`; its
 * timeline is `conversation_messages` (plain `message` rows + typed `outcome` cards).
 * This unifies the old Chat + Work Requests surfaces onto one model. The Chief of Staff
 * replies live via `threadReplyStream` (ADR-013 streaming turn); async operator triage
 * still layers typed `outcome` cards on top. Pure types + `parseMeta` live in the
 * client-safe ./threads module.
 */

export type {
  BranchLink,
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

/**
 * Load a thread with its timeline plus its branch links both ways (work-032): `parent` is
 * the thread this one was branched from (via `parentId`, or null), and `branches` are the
 * child threads branched off this one (derived by querying `parentId`), newest first. The
 * inline `branch` cards in the timeline give the same forward link at the split point; the
 * `branches` list is the durable header/footer view even after the card scrolls away.
 */
export async function getThread(id: number): Promise<{
  thread: Thread;
  messages: ThreadMessage[];
  parent: BranchLink | null;
  branches: BranchLink[];
} | null> {
  await ensureSchema();
  const [thread] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!thread) return null;
  const messages = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, id))
    .orderBy(conversationMessages.at);

  let parent: BranchLink | null = null;
  if (thread.parentId != null) {
    const [p] = await db
      .select({ id: conversations.id, title: conversations.title })
      .from(conversations)
      .where(eq(conversations.id, thread.parentId));
    if (p) parent = { id: p.id, title: p.title };
  }

  const children = await db
    .select({ id: conversations.id, title: conversations.title })
    .from(conversations)
    .where(eq(conversations.parentId, id))
    .orderBy(desc(conversations.updatedAt));
  const branches: BranchLink[] = children.map((c) => ({ id: c.id, title: c.title }));

  return { thread, messages, parent, branches };
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

type BranchOpts = {
  parentId: number;
  title: string;
  body: string;
  /** The timeline point in the parent the tangent split from (the "from a point" record). */
  fromMessageId?: number | null;
  kind?: string;
  /** The branching author's label for the parent's inline `branch` card (default `you`). */
  author?: string;
};

/**
 * Branch a child thread from a point in a parent (work-032). Creates a new thread linked
 * **both ways** — the child carries `parentId` + `branchedFromMessageId` (the reverse link
 * and the split point), and a typed `branch` card is dropped into the parent at that point,
 * deep-linking to the child. The child opens with the Owner's tangent message on the org's
 * turn (`working`), exactly like `createThread`; followups then thread cleanly on the child.
 * Additive on the conversation primitive — no reshape.
 */
export async function branchThread(opts: BranchOpts): Promise<Thread> {
  await ensureSchema();
  const now = Date.now();
  const [child] = await db
    .insert(conversations)
    .values({
      kind: opts.kind ?? "request",
      title: opts.title,
      status: "working",
      initiator: "owner",
      parentId: opts.parentId,
      branchedFromMessageId: opts.fromMessageId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await db.insert(conversationMessages).values({
    conversationId: child.id,
    role: "owner",
    type: "message",
    body: opts.body,
    at: now,
  });
  // The forward link: an inline `branch` card in the parent at the split point, pointing to
  // the child. Insert directly so the parent's turn/status is untouched (a branch is not a
  // reply) — only its `updatedAt` is bumped so it resurfaces.
  await db.insert(conversationMessages).values({
    conversationId: opts.parentId,
    role: opts.author && opts.author !== "you" ? "agent" : "owner",
    type: "branch",
    body: opts.body,
    meta: JSON.stringify({
      label: opts.title,
      refUrl: `/threads/${child.id}`,
      childThreadId: child.id,
      childThreadTitle: opts.title,
      ...(opts.author ? { author: opts.author } : {}),
    } satisfies MessageMeta),
    at: now,
  });
  await db.update(conversations).set({ updatedAt: now }).where(eq(conversations.id, opts.parentId));
  return child;
}

type GeneratedRequestOpts = {
  /** The feature-request headline. */
  label: string;
  /** A one-line summary of the request (the card body). */
  body?: string;
  /** Deep link to the ticket/PRD this request created. */
  refUrl: string;
  /** Short link label (e.g. the ticket id `work-032`). */
  refLabel?: string;
  /** The generating author (default `chief-of-staff`). */
  author?: string;
  /** Optionally flip the thread's turn (a generated request often parks it on the Owner). */
  status?: ThreadStatus;
};

/**
 * Record a **generated feature request** as a first-class inline card in a thread (work-032)
 * — the org distilled a request from the conversation and created a ticket/PRD for it. It's a
 * `generated-request` typed row (reusing the `type` discriminator, ADR-012) whose meta carries
 * the created artifact's deep link, rendered as a card the Owner can click through. Authored by
 * the org (`agent` role), so it never enters the Human-Input Log.
 */
export async function addGeneratedRequest(
  threadId: number,
  opts: GeneratedRequestOpts,
): Promise<void> {
  await addMessage(threadId, "agent", opts.body ?? "", {
    type: "generated-request",
    status: opts.status,
    meta: {
      author: opts.author ?? "chief-of-staff",
      label: opts.label,
      refUrl: opts.refUrl,
      ...(opts.refLabel ? { refLabel: opts.refLabel } : {}),
    },
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
