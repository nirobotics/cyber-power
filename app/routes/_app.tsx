import { Activity } from "lucide-react";
import { Outlet, redirect, useLocation, useNavigation } from "react-router";
import type { Route } from "./+types/_app";
import { AppShell } from "../components/app-shell";
import { useAuth } from "../hooks/useAuth";
import { AuthConfigurationError, requireCurrentUser, sanitizeReturnTo } from "../lib/auth.server";
import { startFeishuLogin } from "../lib/feishu";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    await requireCurrentUser(request);
    return { authenticated: true };
  } catch (error) {
    if (error instanceof AuthConfigurationError) {
      const url = new URL(request.url);
      const returnTo = sanitizeReturnTo(`${url.pathname}${url.search}`);
      throw redirect(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
    }
    throw error;
  }
}

export default function AppLayout() {
  const location = useLocation();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const auth = useAuth();

  return (
    <AppShell
      appName="Cyber Power"
      appSubtitle="FRC Energy Analysis"
      centerTitle="Local WPILOG Analyzer"
      version="1.0.0"
      user={auth.user}
      authLoading={auth.loading}
      allowGuest={false}
      busy={busy}
      onLogin={() => startFeishuLogin(location.pathname)}
      Icon={Activity}
    >
      <Outlet context={{ user: auth.user }} />
    </AppShell>
  );
}

