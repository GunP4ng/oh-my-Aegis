import type { Mode } from "../state/types";
export interface ReportSection {
    title: string;
    content: string;
    artifacts?: string[];
}
export interface Report {
    mode: Mode;
    title: string;
    sections: ReportSection[];
    generatedAt: number;
    markdown: string;
}
/**
 * Parse WORKLOG.md content into timestamp/action/result entries.
 */
export declare function parseWorklog(content: string): Array<{
    timestamp: string;
    action: string;
    result: string;
}>;
/**
 * Parse EVIDENCE.md content into item/verification/artifact entries.
 */
export declare function parseEvidence(content: string): Array<{
    item: string;
    verification: string;
    artifacts: string[];
}>;
/**
 * Generate a CTF writeup from WORKLOG and EVIDENCE markdown sources.
 */
export declare function generateCtfWriteup(worklogContent: string, evidenceContent: string, options?: {
    challengeName?: string;
    category?: string;
    flag?: string;
}): Report;
/**
 * Generate a bounty report from WORKLOG and EVIDENCE markdown sources.
 */
export declare function generateBountyReport(worklogContent: string, evidenceContent: string, options?: {
    programName?: string;
    severity?: string;
    endpoint?: string;
}): Report;
/**
 * Generate a mode-specific report from WORKLOG/EVIDENCE markdown content.
 */
export declare function generateReport(mode: Mode, worklogContent: string, evidenceContent: string, options?: Record<string, string>): Report;
/**
 * Render a report object as markdown.
 */
export declare function formatReportMarkdown(report: Report): string;
