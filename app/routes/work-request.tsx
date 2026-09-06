import { redirect } from "react-router";

/**
 * Legacy redirect (work-029, ADR-012): an individual request thread now lives at
 * /threads/:id on the conversation primitive. The old request id no longer resolves
 * to the new thread id (the mapping was dropped with the legacy tables), so we send
 * stale deep links to the Threads list rather than to a wrong thread.
 */
export function loader() {
  return redirect("/threads");
}
