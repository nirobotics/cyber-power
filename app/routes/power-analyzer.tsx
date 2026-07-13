import { useOutletContext } from "react-router";
import type { AppOutletContext } from "./_app";
import { AnalysisWorkspace } from "../features/power-dashboard/analysis-workspace";

export const meta = () => [{ title: "整机 | cyber-power" }];

export default function PowerAnalyzerRoute() {
  const { setWorkspaceChrome } = useOutletContext<AppOutletContext>();
  return <AnalysisWorkspace onChromeChange={setWorkspaceChrome} />;
}
