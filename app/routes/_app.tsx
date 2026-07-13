import { Zap } from "lucide-react";
import { useState } from "react";
import { Outlet, redirect, useLocation, useNavigation } from "react-router";
import type { Route } from "./+types/_app";
import { AppShell } from "../components/app-shell";
import type { AnalysisWorkspaceChrome } from "../features/power-dashboard/analysis-workspace";
import { useAuth } from "../hooks/useAuth";
import type { PublicUser } from "../lib/auth-types";
import { AuthConfigurationError, requireCurrentUser, sanitizeReturnTo } from "../lib/auth.server";
import { startFeishuLogin } from "../lib/feishu";

export type AppOutletContext = {
  user: PublicUser | null;
  setWorkspaceChrome: (chrome: AnalysisWorkspaceChrome | null) => void;
};

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
  const [workspaceChrome, setWorkspaceChrome] = useState<AnalysisWorkspaceChrome | null>(null);

  return (
    <AppShell
      appName="Cyber Power"
      appSubtitle="FRC 机器人能量分析"
      centerTitle={workspaceChrome?.fileName}
      version="1.0.0"
      user={auth.user}
      authLoading={auth.loading}
      allowGuest={false}
      busy={busy}
      onLogin={() => startFeishuLogin(location.pathname)}
      onReplaceFile={workspaceChrome?.onReplace}
      Icon={Zap}
    >
      <Outlet context={{ user: auth.user, setWorkspaceChrome } satisfies AppOutletContext} />
    </AppShell>
  );
}

