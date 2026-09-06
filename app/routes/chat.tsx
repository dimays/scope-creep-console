import { redirect } from "react-router";

/**
 * Legacy redirect (work-029, ADR-012): the top-level Chat tab was subsumed by the
 * unified Threads surface. The live agent chat is now the `chat`-kind thread under
 * /threads; the ChatMount resource endpoint (/chat/send) is unchanged.
 */
export function loader() {
  return redirect("/threads");
}
