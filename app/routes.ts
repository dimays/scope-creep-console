import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("healthz", "routes/healthz.tsx"),
  route("explore", "routes/explore.tsx"),
  route("explore/docs", "routes/explore-docs.tsx"),
  route("explore/docs/:slug", "routes/explore-doc.tsx"),
  route("explore/agents/:name", "routes/explore-agent.tsx"),
  route("explore/timeline", "routes/explore-timeline.tsx"),
  route("explore/consistency", "routes/explore-consistency.tsx"),
] satisfies RouteConfig;
