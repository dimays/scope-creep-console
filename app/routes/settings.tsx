import { redirect } from "react-router";

/**
 * Legacy redirect. Settings held exactly one control — the Console assistant's
 * chat-model picker (work-018) — and that assistant, the in-app agent-chat runtime,
 * was retired in ADR-019. With nothing left for it to configure (the picker's only
 * consumer was this page itself), a standing Settings tab was dead weight, so the nav
 * entry is gone. The one piece of genuinely useful information it also showed — each
 * agent/template's model preset — already lives where it belongs, on the Org and
 * Templates views (see `modelPreset` in explore-agents). This bare redirect stays so
 * old /settings links resolve there instead of 404ing.
 */
export function loader() {
  return redirect("/explore/agents");
}
