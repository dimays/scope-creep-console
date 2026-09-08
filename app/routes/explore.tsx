import { redirect } from "react-router";
import type { Route } from "./+types/explore";

/**
 * The Explore Overview merged into the Console home (`/`) — one landing that shows both the
 * factory (Threads / Agents / Apps) and the platform surfaces (Docs / Loops / …). This route
 * stays as a redirect so old `/explore` links (and the sub-pages' back-links) still resolve.
 */
export function loader(_: Route.LoaderArgs) {
  return redirect("/");
}
