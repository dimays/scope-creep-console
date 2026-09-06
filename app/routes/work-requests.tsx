import { redirect } from "react-router";

/**
 * Legacy redirect (work-029, ADR-012): the Work→Requests section was folded into the
 * unified Threads surface. A request is now a `request`-kind thread under /threads.
 */
export function loader() {
  return redirect("/threads");
}
