import { Activity } from "lucide-react";
import { Outlet, useLocation, useNavigation } from "react-router";
import type { Route } from "./+types/_app";
import { AppShell } from "../components/app-shell";
import { useAuth } from "../hooks/useAuth";
import { startFeishuLogin } from "../lib/feishu";

export async function loader(_args: Route.LoaderArgs) {
  return { user: null };
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const location = useLocation();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const auth = useAuth();
  const user = auth.user ?? loaderData.user;

  return (
    <AppShell
      appName="Cyber Power"
      appSubtitle="FRC Energy Analysis"
      centerTitle="Local WPILOG Analyzer"
      version="1.0.0"
      user={user}
      authLoading={auth.loading}
      allowGuest
      busy={busy}
      onLogin={() => startFeishuLogin(location.pathname)}
      Icon={Activity}
    >
      <Outlet context={{ user }} />
    </AppShell>
  );
}

