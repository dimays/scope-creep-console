import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Deliberately does NOT load the React Router / Tailwind Vite plugins from
// vite.config.ts — unit/integration tests run against plain modules in node.
const appDir = fileURLToPath(new URL("./app", import.meta.url));

export default defineConfig({
  resolve: {
    // Mirror the tsconfig `~/*` -> `app/*` alias so *.server.ts (which import
    // ~/db) are testable.
    alias: [{ find: /^~\//, replacement: `${appDir}/` }],
  },
  test: {
    environment: "node",
    include: ["app/**/*.test.ts", "test/**/*.test.ts"],
    // A test run may NEVER touch a real store. `guard-local-db.ts` (setupFiles, below) is the
    // hard belt: it aborts the run before any test if the resolved db is remote. This env block
    // is the suspenders — it pins EVERY db-selecting var so no ambient value can win.
    //
    // work-115: pinning only DATABASE_URL was not enough. `resolveDbConfig` reads the namespaced
    // SCOPE_CREEP_DB_* names FIRST (config.ts `firstSet`), so an ambient
    // `SCOPE_CREEP_DB_URL=libsql://…turso.io` (+ token) in a dev's shell profile or the
    // scope-creep-local cloud env silently overrode `:memory:` → the test-time `db` singleton
    // connected to the REMOTE Turso store and `createThread(...)` fixtures leaked into the
    // shared store the request-triage sweep reads. So we pin BOTH namespaces and blank BOTH
    // tokens — an empty string is treated as unset by `firstSet`, so `:memory:` wins and no
    // remote auth token is even available to a run.
    //
    // Integration tests hit the data layer against a throwaway in-memory libSQL, never a real
    // db; empty key forces the agent's offline fallback. The claude-cli scheme probe is forced
    // off so tests are deterministic and skip the slow LaunchServices dump (work-046) — its own
    // unit test still asserts a boolean.
    env: {
      SCOPE_CREEP_DB_URL: ":memory:",
      SCOPE_CREEP_DB_AUTH_TOKEN: "",
      DATABASE_URL: ":memory:",
      DATABASE_AUTH_TOKEN: "",
      ANTHROPIC_API_KEY: "",
      SC_CLAUDE_CLI_SCHEME: "0",
    },
    // Runs before any test file. Aborts the whole run if the resolved db is not local
    // (work-115) — see test/guard-local-db.ts.
    setupFiles: ["./test/guard-local-db.ts"],
  },
});
