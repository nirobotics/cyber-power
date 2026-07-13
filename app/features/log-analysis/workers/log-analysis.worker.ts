/// <reference lib="webworker" />

import { createLogAnalysisWorkerHandler } from "./worker-handler";
import type { LogAnalysisWorkerRequest } from "./protocol";

const handleMessage = createLogAnalysisWorkerHandler({
  post: (response, transfer = []) => self.postMessage(response, { transfer }),
});

self.onmessage = (event: MessageEvent<LogAnalysisWorkerRequest>) => {
  handleMessage(event.data);
};
