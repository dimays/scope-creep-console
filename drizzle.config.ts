import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./app/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    // `db:generate` / `db:migrate` (drizzle-kit) target the local file db. Against a REMOTE
    // libSQL endpoint (ADR-024) the app applies the same generated migrations at boot via
    // `ensureSchema()` (drizzle-orm's libSQL migrator, which carries `DATABASE_AUTH_TOKEN`) —
    // so there is no separate remote deploy-time migration step and drizzle-kit stays local.
    url: process.env.DATABASE_URL ?? "file:./data/app.db",
  },
});
