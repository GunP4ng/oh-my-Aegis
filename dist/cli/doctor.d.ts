type CheckStatus = "pass" | "warn" | "fail";
interface DoctorCheck {
    name: string;
    status: CheckStatus;
    message: string;
    details?: Record<string, unknown>;
}
interface DoctorReport {
    ok: boolean;
    generatedAt: string;
    projectDir: string;
    checks: DoctorCheck[];
}
export declare function runDoctor(projectDir: string): DoctorReport;
export {};
