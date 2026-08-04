import { useState } from "react";
import { Outlet, useNavigation } from "react-router";
import { AppShell } from "../components/app-shell";
import type { AnalysisWorkspaceChrome } from "../features/power-dashboard/analysis-workspace";

export type AppOutletContext = {
  setWorkspaceChrome: (chrome: AnalysisWorkspaceChrome | null) => void;
};

export default function AppLayout() {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const [workspaceChrome, setWorkspaceChrome] = useState<AnalysisWorkspaceChrome | null>(null);

  return (
    <AppShell
      centerTitle={workspaceChrome?.fileName}
      busy={busy}
      onReplaceFile={workspaceChrome?.onReplace}
    >
      <Outlet context={{ setWorkspaceChrome } satisfies AppOutletContext} />
    </AppShell>
  );
}

