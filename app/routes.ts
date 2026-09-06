import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("healthz", "routes/healthz.tsx"),
  route("feedback", "routes/feedback.tsx"),
  // CoS-Threads (work-029, ADR-012): the unified, top-level human-input surface.
  route("threads", "routes/threads.tsx"),
  route("threads/:id", "routes/thread.tsx"),
  route("thread/send", "routes/thread-send.tsx"),
  // Live agent-chat resource + chatbot preview/merge flow (unchanged; ChatMount posts here).
  route("chat/send", "routes/chat-send.tsx"),
  route("chat/preview", "routes/chat-preview.tsx"),
  route("chat/land", "routes/chat-land.tsx"),
  route("chat/decline", "routes/chat-decline.tsx"),
  // Legacy redirect → Threads (old top-level Chat tab).
  route("chat", "routes/chat.tsx"),
  route("explore", "routes/explore.tsx"),
  route("explore/docs", "routes/explore-docs.tsx"),
  route("explore/docs/:slug", "routes/explore-doc.tsx"),
  route("explore/agents/:name", "routes/explore-agent.tsx"),
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
