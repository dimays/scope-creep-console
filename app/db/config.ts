/**
 * DB connection resolution (work-065, ADR-024). Pure, env-in / config-out, so the
 * remote-vs-local decision has a single source of truth and is unit-testable without the
 * module-load singleton in `./index.ts`.
 *
 * ADR-024 makes the store **remote-capable**: the same `@libsql`/Drizzle client, same sqlite
 * dialect, same generated migrations, pointed at a hosted `libsql://…` endpoint by a
 * connection-string change — never a rewrite. Two env vars carry it:
 *
 *   - `DATABASE_URL`        — `file:./data/app.db` locally (the default), a hosted
 *                             `libsql://<db>.turso.io` (or `https://…`) endpoint in the
 *                             console's deploy environment.
 *   - `DATABASE_AUTH_TOKEN` — the **scoped** libSQL auth token for that database only. It is
 *                             an infrastructure credential, NOT a user identity (INVARIANTS
 *                             §II — single-user, no auth surface in the app). Held in the
 *                             environment, never in the repo. Unset for a local file db.
 *
 * The per-environment switch (INVARIANTS §9 — "the default datastore is never production")
 * is preserved: nothing points local at a remote by default, and a remote endpoint is
 * refused unless it carries its own scoped token.
 */

/** The default local datastore — a file db, never a remote (INVARIANTS §9). */
export const DEFAULT_DATABASE_URL = "file:./data/app.db";

/**
 * Whether a `DATABASE_URL` names a **remote** libSQL endpoint (Turso / self-hosted `sqld`)
 * as opposed to a local file or in-memory db. libSQL reaches a remote over `libsql://` (its
 * native scheme) or an `http(s)`/`ws(s)` URL; everything else (`file:`, `:memory:`, a bare
 * path) is local.
 */
export function isRemoteUrl(url: string): boolean {
  return /^(libsql|https?|wss?):\/\//.test(url);
}

/** The resolved libSQL client config plus whether it targets a remote endpoint. */
export type DbConfig = {
  url: string;
  /** Present only for a remote endpoint; a local file/in-memory db needs no token. */
  authToken?: string;
  remote: boolean;
};

/**
 * Resolve the libSQL client config from the environment. Throws — loudly, at boot — when a
 * remote endpoint is configured without its scoped auth token, rather than silently
 * connecting tokenless or falling back to a local db (which would be the "silently empty
 * thread list" ADR-024 forbids). A local file/in-memory url ignores any stray token.
 */
export function resolveDbConfig(
  env: { DATABASE_URL?: string; DATABASE_AUTH_TOKEN?: string } = process.env,
): DbConfig {
  const url = env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const remote = isRemoteUrl(url);
  const authToken = env.DATABASE_AUTH_TOKEN?.trim() || undefined;

  if (remote && !authToken) {
    throw new Error(
      `DATABASE_URL points at a remote libSQL endpoint (${url}) but DATABASE_AUTH_TOKEN is not set. ` +
        "A remote thread store requires its own scoped auth token (ADR-024, INVARIANTS §9). " +
        "Set DATABASE_AUTH_TOKEN in the environment, or point DATABASE_URL at a local file db " +
        `(${DEFAULT_DATABASE_URL}) for local development.`,
    );
  }

  return remote ? { url, authToken, remote } : { url, remote };
}
