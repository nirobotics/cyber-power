import { index, layout, prefix, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  layout("routes/_app.tsx", [index("routes/power-analyzer.tsx")]),
  ...prefix("auth", [
    route("login", "routes/auth.login.tsx"),
    route("feishu/callback", "routes/auth.feishu.callback.tsx"),
    route("logout", "routes/auth.logout.tsx"),
  ]),
  route("api/auth/me", "routes/api.auth.me.ts"),
  route("api/version", "routes/api.version.ts"),
] satisfies RouteConfig;
