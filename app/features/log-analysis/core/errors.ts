import type { LogIssue, LogIssueCode } from "./types";

export class LogAnalysisError extends Error {
  readonly issues: LogIssue[];

  constructor(issueOrIssues: LogIssue | LogIssue[]) {
    const issues = Array.isArray(issueOrIssues) ? issueOrIssues : [issueOrIssues];
    super(issues.map((issue) => issue.message).join("; "));
    this.name = "LogAnalysisError";
    this.issues = issues;
  }
}

export function fatalIssue(
  code: Extract<LogIssueCode, string>,
  message: string,
  fields: Omit<LogIssue, "severity" | "code" | "message"> = {},
): LogIssue {
  return { severity: "fatal", code, message, ...fields };
}

export function warningIssue(
  code: Extract<LogIssueCode, string>,
  message: string,
  fields: Omit<LogIssue, "severity" | "code" | "message"> = {},
): LogIssue {
  return { severity: "warning", code, message, ...fields };
}
