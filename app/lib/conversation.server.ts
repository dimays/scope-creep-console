import { desc, eq } from "drizzle-orm";
import { db, ensureSchema } from "~/db";
import { conversationMessages, conversations } from "~/db/schema";
import { type AgentMessage, type AgentRole, agentRespond } from "./agent.server";

/**
 * The conversation primitive (ADR-008): persisted threads + an agent turn.
 * Work Requests v2 will adopt this same layer (its `requests` tables generalize
 * here) — deferred to keep the working Requests feature intact.
 */

const GREETING =
  "Hi — I'm the Console's in-app assistant (work-014). Ask me about the platform. " +
  "Code-editing (live preview + merge) arrives in work-015/016.";

/** The single ongoing conversation for a given kind (e.g. the Chat tab). */
export async function getOrCreateConversation(kind: string, title: string): Promise<number> {
  await ensureSchema();
  const [existing] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.kind, kind))
    .orderBy(desc(conversations.id))
    .limit(1);
  if (existing) return existing.id;

  const now = Date.now();
  const [row] = await db
    .insert(conversations)
    .values({ kind, title, createdAt: now, updatedAt: now })
    .returning();
  await db
    .insert(conversationMessages)
    .values({ conversationId: row.id, role: "agent", body: GREETING, at: now });
  return row.id;
}

export async function listMessages(conversationId: number): Promise<AgentMessage[]> {
  await ensureSchema();
  const rows = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId))
    .orderBy(conversationMessages.at);
  return rows.map((r) => ({ role: r.role as AgentRole, body: r.body }));
}

async function addMessage(conversationId: number, role: AgentRole, body: string): Promise<void> {
  const now = Date.now();
  await db.insert(conversationMessages).values({ conversationId, role, body, at: now });
  await db
    .update(conversations)
    .set({ updatedAt: now })
    .where(eq(conversations.id, conversationId));
}

/** Record the owner's message, get the agent's reply, record it, and return it. */
export async function agentTurn(conversationId: number, userText: string): Promise<string> {
  await ensureSchema();
  const history = await listMessages(conversationId);
  await addMessage(conversationId, "owner", userText);
  const reply = await agentRespond(history, userText);
  await addMessage(conversationId, "agent", reply);
  return reply;
}
