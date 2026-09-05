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
