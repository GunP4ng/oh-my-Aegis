export type CheckStatus = "pass" | "warn" | "fail";
export interface DoctorCheck {
    name: string;
    status: CheckStatus;
    message: string;
    details?: Record<string, unknown>;
}
export interface DoctorReport {
    ok: boolean;
    generatedAt: string;
    projectDir: string;
    checks: DoctorCheck[];
}
export declare function formatDoctorReport(report: DoctorReport): string;
export declare function runDoctor(projectDir: string): DoctorReport;
