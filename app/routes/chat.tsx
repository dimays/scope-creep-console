import { redirect } from "react-router";

/**
 * Legacy redirect (work-029, ADR-012): the top-level Chat tab was subsumed by the
 * unified Threads surface, so /chat sends the Owner to /threads. The in-app agent-chat
 * runtime that once backed a live chat here was retired in ADR-019; this bare redirect
 * remains only so old /chat links don't 404.
 */
export function loader() {
  return redirect("/threads");
}
