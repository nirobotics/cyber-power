import { useOutletContext } from "react-router";
import type { AppOutletContext } from "./_app";
import { AnalysisWorkspace } from "../features/power-dashboard/analysis-workspace";

export const meta = () => [{ title: "Cyber Power · WPILOG 能量分析" }];

export default function PowerAnalyzerRoute() {
  const { setWorkspaceChrome } = useOutletContext<AppOutletContext>();
  return <AnalysisWorkspace onChromeChange={setWorkspaceChrome} />;
}
