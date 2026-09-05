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
    include: ["app/**/*.test.ts"],
    // Integration tests hit the data layer against a throwaway in-memory libSQL,
    // never the real dev db; empty key forces the agent's offline fallback.
    env: { DATABASE_URL: ":memory:", ANTHROPIC_API_KEY: "" },
  },
});
