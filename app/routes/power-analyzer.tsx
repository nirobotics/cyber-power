import { AnalysisWorkspace } from "../features/power-dashboard/analysis-workspace";

export const meta = () => [{ title: "Cyber Power · Upload WPILOG" }];

export default function PowerAnalyzerRoute() {
  return <AnalysisWorkspace />;
}
