import { desc, eq } from "drizzle-orm";
import { db, ensureSchema } from "~/db";
import { type Request, type RequestMessage, requestMessages, requests } from "~/db/schema";

/** Work Requests data layer — the request-intake system of record (per the loop). */

export async function listRequests(): Promise<Request[]> {
  await ensureSchema();
  return db.select().from(requests).orderBy(desc(requests.updatedAt));
}

export async function getRequest(
  id: number,
): Promise<{ request: Request; messages: RequestMessage[] } | null> {
  await ensureSchema();
  const [request] = await db.select().from(requests).where(eq(requests.id, id));
  if (!request) return null;
  const messages = await db
    .select()
    .from(requestMessages)
    .where(eq(requestMessages.requestId, id))
    .orderBy(requestMessages.at);
  return { request, messages };
}

export async function createRequest(title: string, body: string): Promise<Request> {
  await ensureSchema();
  const now = Date.now();
  const [row] = await db
    .insert(requests)
    .values({ title, status: "open", createdAt: now, updatedAt: now })
    .returning();
  await db.insert(requestMessages).values({ requestId: row.id, author: "owner", body, at: now });
  return row;
}

export async function addMessage(
  requestId: number,
  author: string,
  body: string,
  status?: string,
): Promise<void> {
  await ensureSchema();
  const now = Date.now();
  await db.insert(requestMessages).values({ requestId, author, body, at: now });
  const patch: { updatedAt: number; status?: string } = { updatedAt: now };
  if (status) patch.status = status;
  await db.update(requests).set(patch).where(eq(requests.id, requestId));
}
