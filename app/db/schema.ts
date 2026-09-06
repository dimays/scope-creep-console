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
 * Requests bug).
 */
export const conversations = sqliteTable("conversations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  title: text("title").notNull().default(""),
  status: text("status").notNull().default("open"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * A thread's timeline item. `type` discriminates a plain `message` from a typed card:
 * `outcome` (a request-intake result — ticket created, decline-with-reason, …). Later
 * phases add `agent-activity` (work-031) and `generated-request` (work-032) on this same
 * column — additive, no reshape. `meta` is optional JSON for the card (author label,
 * outcome kind, deep-link refUrl).
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
