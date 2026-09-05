import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * v0.1 schema. One table: a record of Console page visits, enough to prove the
 * Golden Path data layer (Drizzle + libSQL, TypeScript-checked) end to end.
 * Grows via drizzle-kit migrations as the Console earns real features.
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

/** Work Requests: an intake thread (title + status) with a message conversation. */
export const requests = sqliteTable("requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  status: text("status").notNull().default("open"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const requestMessages = sqliteTable("request_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  requestId: integer("request_id").notNull(),
  author: text("author").notNull(),
  body: text("body").notNull(),
  at: integer("at").notNull(),
});

export type Request = typeof requests.$inferSelect;
export type RequestMessage = typeof requestMessages.$inferSelect;
