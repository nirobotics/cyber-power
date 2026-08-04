import { index, layout, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  layout("routes/_app.tsx", [index("routes/power-analyzer.tsx")]),
  route("api/version", "routes/api.version.ts"),
] satisfies RouteConfig;
