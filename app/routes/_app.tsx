import { useState } from "react";
import { Outlet, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/_app";
import { AppShell } from "../components/app-shell";
import type { AnalysisWorkspaceChrome } from "../features/power-dashboard/analysis-workspace";
import { useAuth } from "../hooks/useAuth";
import { AuthConfigurationError, requireCurrentUser, sanitizeReturnTo } from "../lib/auth.server";

export type AppOutletContext = {
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
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const auth = useAuth();
  const [workspaceChrome, setWorkspaceChrome] = useState<AnalysisWorkspaceChrome | null>(null);

  return (
    <AppShell
      centerTitle={workspaceChrome?.fileName}
      user={auth.user}
      authLoading={auth.loading}
      busy={busy}
      onReplaceFile={workspaceChrome?.onReplace}
    >
      <Outlet context={{ setWorkspaceChrome } satisfies AppOutletContext} />
    </AppShell>
  );
}

