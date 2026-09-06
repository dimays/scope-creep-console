import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The Console schema — the single source of truth for the database. The generated
 * migrations in `drizzle/` are derived from this file (`bun run db:generate`) and
 * applied by `ensureSchema()` at bootstrap; never hand-write DDL elsewhere. Four
 * tables: page_visits, feedback, conversations(+messages).
 *
 * CoS-Threads (work-029, ADR-012): the legacy `requests`/`request_messages` tables were
 * migrated into `conversations`/`conversation_messages` (see drizzle/0001_*.sql) and
 * retired — one thread model backs Chat, Requests, and everything after.
 */
export const pageVisits = sqliteTable("page_visits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  path: text("path").notNull(),
  at: integer("at").notNull(),
});

export type PageVisit = typeof pageVisits.$inferSelect;

/** Feedback recorded by the @scope-creep/ext-feedback extension. */
export const feedback = sqliteTable("feedback", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contextKey: text("context_key").notNull(),
  rating: text("rating").notNull(),
  comment: text("comment").notNull().default(""),
  at: integer("at").notNull(),
});

export type Feedback = typeof feedback.$inferSelect;

/**
 * The shared conversation primitive (ADR-008) — now the one **thread** model behind
 * CoS-Threads (ADR-012). `kind` distinguishes uses (`chat`, `request`, …); `status`
 * carries the thread lifecycle/turn — `open → (needs-you | working) → closed` — so
 * "whose turn is it" is a stored field, not derived (the native fix for the work-011
 * Requests bug). `initiator` records who opened the thread — the Owner (default) or the
 * `org` when the Chief of Staff opens one to get the Owner's input (work-030). It's
 * additive: an org opener is an `agent` message, so it never enters the Human-Input Log
 * (which unions only `role = owner`).
 *
 * Branching (work-032): a thread can be a **child branched from a point in a parent** —
 * `parentId` is the reverse link (child→parent) and `branchedFromMessageId` records the
 * timeline point it split from. The forward link (parent→children) is derived by querying
 * `parentId`, and a typed `branch` card is dropped in the parent at the split point, so the
 * two threads are linked both ways with no reshape. Both columns are nullable — a plain
 * (non-branched) thread leaves them null.
 */
export const conversations = sqliteTable("conversations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  title: text("title").notNull().default(""),
  status: text("status").notNull().default("open"),
  initiator: text("initiator").notNull().default("owner"),
  parentId: integer("parent_id"),
  branchedFromMessageId: integer("branched_from_message_id"),
  // Threads launcher (work-046/047, ADR-016): when the Owner launches a thread into a
  // Claude Code session, `launchedAt` marks the moment (and flips the in-app input to a
  // "Resume in Claude" control). `sessionUuid`/`sessionPath` are the correlated local
  // session JSONL, resolved by marker and persisted here so we never rescan. All nullable:
  // a thread that was never launched leaves them null.
  launchedAt: integer("launched_at"),
  sessionUuid: text("session_uuid"),
  sessionPath: text("session_path"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * A thread's timeline item. `type` discriminates a plain `message` from a typed card:
 * `outcome` (a request-intake result — ticket created, decline-with-reason, …),
 * `generated-request` (work-032 — a generated feature request linking to the ticket/PRD it
 * created), and `branch` (work-032 — an in-parent marker pointing to a child thread). A
 * later phase adds `agent-activity` (work-031) on this same column — additive, no reshape.
 * `meta` is optional JSON for the card (author label, outcome/card label, deep-link refUrl,
 * and for a `branch` card the child thread it points to).
 */
export const conversationMessages = sqliteTable("conversation_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: integer("conversation_id").notNull(),
  role: text("role").notNull(),
  type: text("type").notNull().default("message"),
  body: text("body").notNull(),
  meta: text("meta"),
  at: integer("at").notNull(),
});

export type Conversation = typeof conversations.$inferSelect;
export type ConversationMessage = typeof conversationMessages.$inferSelect;

/**
 * A tiny key/value store for persisted Console settings (work-018). The first key is
 * `chat_model` — the Owner's picked chat model, which overrides the `CHAT_MODEL` env
 * default when it's a valid id in the catalog. Single-user by invariant, so no scoping.
 */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type Setting = typeof settings.$inferSelect;
