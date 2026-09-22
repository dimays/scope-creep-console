/**
 * work-115 — the hard guard that makes a test run against a real store IMPOSSIBLE.
 *
 * Registered as a vitest `setupFiles` module (see vitest.config.ts), so it runs ONCE before
 * any test file is collected. It resolves the db config the exact way `app/db/index.ts` does
 * at import — via {@link resolveDbConfig} — and ABORTS the whole run if that config would
 * target anything other than a local in-memory / `file:` db.
 *
 * Why this exists on top of the `env` pins in vitest.config.ts: those pins are the suspenders
 * (they blank every db-selecting var so `:memory:` wins). This is the belt. Even if a future
 * change to the env-precedence logic, a stray config edit, or a new db-selecting var were to
 * let an ambient `SCOPE_CREEP_DB_URL=libsql://…turso.io` slip through, the run fails CLOSED
 * here — before a single `createThread(...)` can write a fixture into the shared Turso store
 * the request-triage sweep reads (the work-115 contamination). A test run may never touch a
 * remote / `DATABASE_URL` store.
 *
 * The check is a pure function ({@link assertLocalTestDb}) so it is unit-testable directly
 * (test/guard-local-db.test.ts) without depending on the ambient env — vitest's own `test.env`
 * would mask an ambient value inside the runner, which is exactly why the guard logic is proven
 * in isolation rather than only by an ambient-env experiment.
 */
import { type DbConfig, resolveDbConfig } from "~/db/config";

/**
 * Throw loudly unless `config` targets a local db (`:memory:` or a `file:` url and NOT remote).
 * Pure — takes the resolved config, so the same assertion is exercised in a unit test with a
 * hand-built remote config. Returns the config unchanged when it is safe.
 */
export function assertLocalTestDb(config: DbConfig): DbConfig {
  const isLocal = !config.remote && (config.url === ":memory:" || config.url.startsWith("file:"));
  if (!isLocal) {
    throw new Error(
      `[work-115] Refusing to run tests: the resolved test db is not local.\n` +
        `  resolved url : ${config.url}\n` +
        `  remote       : ${config.remote}\n` +
        `A test run may NEVER target a remote / DATABASE_URL store — test helpers call ` +
        `createThread(...) and other writers, and those fixtures would leak into the shared ` +
        `store the request-triage sweep reads (work-115 contamination). Unset SCOPE_CREEP_DB_URL / ` +
        `DATABASE_URL (and their *_AUTH_TOKEN) in your environment, or point them at ':memory:' ` +
        `or a 'file:' db. vitest.config.ts pins these for the run; an override reached this far, ` +
        `so the run is aborted.`,
    );
  }
  return config;
}

// Runs at setup time (import), before any test. Uses the same resolution as app/db/index.ts.
assertLocalTestDb(resolveDbConfig());
