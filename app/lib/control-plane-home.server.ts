import { statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

/**
 * Resolve the control-plane repo (work-107): the single source of truth for every console
 * server module that reads `SCOPE_CREEP_HOME`. Previously each module re-derived
 * `process.env.SCOPE_CREEP_HOME ?? join(cwd, "..", "scope-creep")` independently; `bun run dev`
 * does not load `.env`, so that fallback is load-bearing and must resolve identically everywhere.
 */

/**
 * Resolve the control-plane repo — the `cwd` a launched Claude Code session opens in — to an
 * **absolute, real directory**, or `null` when it can't be resolved (work-099). This is the
 * only value allowed to feed a launch URL: a deep link must never carry a bogus, relative, or
 * empty `cwd`, so an unresolved home degrades the UI to the honest needs-you/config state.
 *
 * Resolution: prefer `SCOPE_CREEP_HOME`; else the historical sibling default
 * (`<cwd>/../scope-creep`). Either way we `resolve()` to an absolute path (collapsing any `..`,
 * which the deep-link handler also rejects) and confirm it is a real directory on disk. The
 * old `SCOPE_CREEP_HOME ?? join(cwd,"..","scope-creep")` was unsound: in dev `.env` isn't
 * loaded so the env var is inert and the path was correct only by the coincidence that the
 * console sits beside the control plane, and on a deployed Linux console (cwd `/app`) the
 * fallback yields a bogus `/scope-creep`. We fail honestly instead of emitting that.
 */
export function resolveControlPlaneHome(): string | null {
  const raw = process.env.SCOPE_CREEP_HOME?.trim();
  const candidate = raw && raw.length > 0 ? raw : join(process.cwd(), "..", "scope-creep");
  const abs = resolve(candidate);
  if (!isAbsolute(abs)) return null;
  try {
    if (statSync(abs).isDirectory()) return abs;
  } catch {
    // Not on disk (deployed console without the control plane mounted, or a wrong path).
  }
  return null;
}

/**
 * A string accessor kept for callers that only need a best-effort path (e.g. as the *preferred*
 * directory to check first in a scan that tolerates a wrong value). Falls back to the raw
 * sibling path when the home can't be resolved to a real dir. **Never used to build a launch
 * URL** — those go through `resolveControlPlaneHome()` (null → honest fallback), so a bogus path
 * here can only misorder a scan or point a read at a missing dir, never mislead the Owner.
 */
export function controlPlaneHome(): string {
  return (
    resolveControlPlaneHome() ??
    (process.env.SCOPE_CREEP_HOME?.trim() || join(process.cwd(), "..", "scope-creep"))
  );
}
