export interface WindowsCliFallbackCandidate {
    name: string;
    command: string;
    install: string[];
    rationale: string;
}
export interface WindowsCliFallbackPlan {
    tool: string;
    purpose: string;
    candidates: WindowsCliFallbackCandidate[];
    searchCommands: string[];
}
export declare function buildWindowsCliFallbackPlan(tool: string, purpose?: string): WindowsCliFallbackPlan;
