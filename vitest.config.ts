import { defineConfig } from "vitest/config";

// Deliberately does NOT load the React Router / Tailwind Vite plugins from
// vite.config.ts — unit tests run against plain modules in a node environment.
export default defineConfig({
  test: {
    environment: "node",
    include: ["app/**/*.test.ts"],
  },
});
