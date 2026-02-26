export interface EnvInfo {
    arch: string;
    libcVersion?: string;
    libcPath?: string;
    ldPath?: string;
    pythonVersion?: string;
    dockerImage?: string;
    seccompProfile?: string;
}
export interface ParityCheck {
    aspect: string;
    local: string;
    remote: string;
    match: boolean;
    fixCommand?: string;
}
export interface ParityReport {
    checks: ParityCheck[];
    allMatch: boolean;
    fixCommands: string[];
    summary: string;
}
/**
 * Parse Dockerfile content and extract environment hints.
 */
export declare function parseDockerfile(content: string): Partial<EnvInfo>;
/**
 * Generate local shell commands to detect environment properties.
 */
export declare function localEnvCommands(): string[];
/**
 * Parse ldd output and extract libc path/version if available.
 */
export declare function parseLddOutput(output: string): {
    libcPath: string;
    version: string;
} | null;
/**
 * Generate patchelf commands to align local binary against remote runtime.
 */
export declare function generatePatchelfCommands(binaryPath: string, env: EnvInfo): string[];
/**
 * Generate a docker run command approximating the remote environment.
 */
export declare function generateDockerCommand(env: EnvInfo, binaryPath: string): string;
/**
 * Build parity checks between local and remote environment descriptors.
 */
export declare function buildParityReport(local: Partial<EnvInfo>, remote: Partial<EnvInfo>): ParityReport;
/**
 * Build a prompt-ready parity summary with prioritized fixes.
 */
export declare function buildParitySummary(report: ParityReport): string;
export interface DomainEnvCheck {
    tool: string;
    command: string;
    purpose: string;
}
export declare function domainEnvCommands(targetType: string): DomainEnvCheck[];
