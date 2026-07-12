import { Outlet, redirect, useLocation, useNavigation } from "react-router";
import type { Route } from "./+types/_app";
import { AppShell } from "../components/app-shell";
import { useAuth } from "../hooks/useAuth";
import { startFeishuLogin } from "../lib/feishu";

const AUTH_MODE: "guest-compatible" | "login-required" = "guest-compatible";

export async function loader({ request }: Route.LoaderArgs) {
  if (AUTH_MODE === "login-required") {
    const user = await requireCurrentUser(request);
    return { user };
  }

  const user = await getOptionalCurrentUser(request);
  return { user };
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const location = useLocation();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const auth = useAuth();
  const user = auth.user ?? loaderData.user;

  return (
    <AppShell
      appName="REPLACE_APP_NAME"
      appSubtitle="REPLACE_APP_SUBTITLE"
      centerTitle="REPLACE_CENTER_TITLE"
      version="1.0.0"
      user={user}
      authLoading={auth.loading}
      allowGuest={AUTH_MODE === "guest-compatible"}
      busy={busy}
      onLogin={() => startFeishuLogin(location.pathname)}
    >
      <Outlet context={{ user }} />
    </AppShell>
  );
}

async function getOptionalCurrentUser(_request: Request) {
  return null;
}

async function requireCurrentUser(request: Request) {
  const user = await getOptionalCurrentUser(request);
  if (!user) {
    const url = new URL(request.url);
    throw redirect(`/auth/login?returnTo=${encodeURIComponent(url.pathname + url.search)}`);
  }
  return user;
}
