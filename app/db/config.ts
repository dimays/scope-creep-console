/**
 * DB connection resolution (work-065, ADR-024). Pure, env-in / config-out, so the
 * remote-vs-local decision has a single source of truth and is unit-testable without the
 * module-load singleton in `./index.ts`.
 *
 * ADR-024 makes the store **remote-capable**: the same `@libsql`/Drizzle client, same sqlite
 * dialect, same generated migrations, pointed at a hosted `libsql://…` endpoint by a
 * connection-string change — never a rewrite. Two values carry it — a URL and a token —
 * each read from a `SCOPE_CREEP_DB_*` name first (safe to export in a personal shell
 * profile), then a `DATABASE_*` fallback (what the cloud routine's env injects). See
 * {@link resolveDbConfig}. Canonically:
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

/**
 * Force the **HTTP transport** for a remote libSQL url by normalizing its scheme to
 * `http(s)://`. The `@libsql` client picks its transport from the URL scheme:
 * `libsql://` / `wss://` / `ws://` open a long-lived **WebSocket**, while `https://` /
 * `http://` use **hrana-over-HTTP**.
 *
 * The WebSocket transport is dropped by the cloud routine's egress proxy — a run failed with
 * `ws_closed_mid_exchange` (the proxy closes the long-lived socket mid-exchange) while HTTP to
 * the same host succeeded (`curl …/v2/pipeline` → 200, `createClient({ url: "https://…" })`
 * ran `SELECT 1` OK). HTTP is functionally equivalent for our access and works everywhere —
 * locally and behind the proxy — so we normalize remote urls to the HTTP transport. This lets
 * the environment keep the `libsql://` URL Turso hands out; no env-var change is needed.
 * See ADR-024 / work-065.
 *
 *   libsql:// → https://   ·   wss:// → https://   ·   ws:// → http://
 *   https:// / http:// pass through unchanged.
 *
 * `file:` (local) and any non-remote url are returned untouched. Intended to run on a url
 * already classified remote by {@link isRemoteUrl}.
 */
export function toHttpTransportUrl(url: string): string {
  const scheme = /^(libsql|wss|ws|https?):\/\//.exec(url)?.[1];
  if (!scheme) return url; // not a remote scheme (e.g. file:, :memory:) — leave untouched
  const httpScheme = scheme === "ws" || scheme === "http" ? "http" : "https";
  return url.replace(/^[a-z]+:\/\//, `${httpScheme}://`);
}

/** The resolved libSQL client config plus whether it targets a remote endpoint. */
export type DbConfig = {
  url: string;
  /** Present only for a remote endpoint; a local file/in-memory db needs no token. */
  authToken?: string;
  remote: boolean;
};

/** First env value that is a non-empty (trimmed) string, else undefined. Lets a namespaced
 * `SCOPE_CREEP_DB_*` var take precedence over the generic `DATABASE_*` fallback, while an
 * empty export (`export SCOPE_CREEP_DB_URL=`) is treated as unset rather than shadowing. */
function firstSet(...vals: (string | undefined)[]): string | undefined {
  for (const v of vals) {
    const t = v?.trim();
    if (t) return t;
  }
  return undefined;
}

/**
 * Resolve the libSQL client config from the environment. Throws — loudly, at boot — when a
 * remote endpoint is configured without its scoped auth token, rather than silently
 * connecting tokenless or falling back to a local db (which would be the "silently empty
 * thread list" ADR-024 forbids). A local file/in-memory url ignores any stray token.
 *
 * Each field reads the first set of two names — the `SCOPE_CREEP_DB_*` namespaced name (safe
 * to export in a personal `.zprofile` without colliding with other apps), then the
 * `DATABASE_*` fallback the cloud routine's environment injects (ADR-025) and the
 * conventional local name:
 *   URL   — `SCOPE_CREEP_DB_URL`        → `DATABASE_URL`        → `file:./data/app.db`
 *   token — `SCOPE_CREEP_DB_AUTH_TOKEN` → `DATABASE_AUTH_TOKEN`
 */
export function resolveDbConfig(
  env: {
    SCOPE_CREEP_DB_URL?: string;
    SCOPE_CREEP_DB_AUTH_TOKEN?: string;
    DATABASE_URL?: string;
    DATABASE_AUTH_TOKEN?: string;
  } = process.env,
): DbConfig {
  const url = firstSet(env.SCOPE_CREEP_DB_URL, env.DATABASE_URL) ?? DEFAULT_DATABASE_URL;
  const remote = isRemoteUrl(url);
  const authToken = firstSet(env.SCOPE_CREEP_DB_AUTH_TOKEN, env.DATABASE_AUTH_TOKEN);

  if (remote && !authToken) {
    throw new Error(
      `The thread store URL points at a remote libSQL endpoint (${url}) but no auth token is set. ` +
        "A remote thread store requires its own scoped auth token (ADR-024, INVARIANTS §9). " +
        "Set SCOPE_CREEP_DB_AUTH_TOKEN (or DATABASE_AUTH_TOKEN) in the environment, or point the " +
        `URL at a local file db (${DEFAULT_DATABASE_URL}) for local development.`,
    );
  }

  // Remote: normalize to the HTTP transport so we work behind the cloud routine's egress
  // proxy, which drops the WebSocket transport that `libsql://`/`wss://` would select
  // (`ws_closed_mid_exchange`). See toHttpTransportUrl / ADR-024 / work-065.
  return remote ? { url: toHttpTransportUrl(url), authToken, remote } : { url, remote };
}
