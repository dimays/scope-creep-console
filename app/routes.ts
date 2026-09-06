import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("healthz", "routes/healthz.tsx"),
  route("feedback", "routes/feedback.tsx"),
  // CoS-Threads (work-029, ADR-012): the unified, top-level human-input surface.
  route("threads", "routes/threads.tsx"),
  // The Archive view (work-049) — static segment before `:id` so it isn't shadowed.
  route("threads/archive", "routes/threads-archive.tsx"),
  route("threads/:id", "routes/thread.tsx"),
  // Legacy redirect → Threads (old top-level Chat tab). The in-app agent-chat runtime and
  // the Propose surface it backed were retired per ADR-019; this bare redirect stays so old
  // /chat links don't 404.
  route("chat", "routes/chat.tsx"),
  route("explore", "routes/explore.tsx"),
  route("explore/docs", "routes/explore-docs.tsx"),
  route("explore/docs/:slug", "routes/explore-doc.tsx"),
  // Org & staffing (ADR-017 / prd-org-and-staffing): the reporting tree + template catalog.
  route("explore/agents", "routes/explore-agents.tsx"),
  route("explore/agents/:name", "routes/explore-agent.tsx"),
  route("explore/templates", "routes/explore-templates.tsx"),
  route("explore/templates/:name", "routes/explore-template.tsx"),
  // Gated authoring into the control plane (spin up employee / author template).
  route("org/employee/preview", "routes/org-employee-preview.tsx"),
  route("org/employee/land", "routes/org-employee-land.tsx"),
  route("org/template/preview", "routes/org-template-preview.tsx"),
  route("org/template/land", "routes/org-template-land.tsx"),
  route("explore/loops", "routes/explore-loops.tsx"),
  route("explore/loops/:name", "routes/explore-loop.tsx"),
  route("explore/timeline", "routes/explore-timeline.tsx"),
  route("explore/consistency", "routes/explore-consistency.tsx"),
  route("work", "routes/work.tsx"),
  route("work/history", "routes/work-history.tsx"),
  // Legacy redirects → Threads (old Work→Requests section).
  route("work/requests", "routes/work-requests.tsx"),
  route("work/requests/:id", "routes/work-request.tsx"),
  route("work/inputs", "routes/work-inputs.tsx"),
  route("work/:id", "routes/work-item.tsx"),
  // Owner settings — model picker (work-018) and future persisted preferences.
  route("settings", "routes/settings.tsx"),
] satisfies RouteConfig;
