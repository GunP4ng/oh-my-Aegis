export interface SingleWriterApplyLockHolder {
    pid: number;
    sessionID: string;
    acquiredAtMs: number;
}
export interface SingleWriterApplyLockAudit {
    acquiredAtMs: number;
    recovered: boolean;
    recoveredAtMs?: number;
    recoveredFrom?: SingleWriterApplyLockHolder;
}
export interface SingleWriterApplyLockOptions {
    projectDir: string;
    sessionID: string;
    staleAfterMs?: number;
    pid?: number;
    now?: () => number;
    rootDirName?: string;
    lockFileName?: string;
}
export interface SingleWriterApplyLockSuccessResult<T> {
    ok: true;
    value: T;
    holder: SingleWriterApplyLockHolder;
    audit: SingleWriterApplyLockAudit;
    lockPath: string;
}
export interface SingleWriterApplyLockDeniedResult {
    ok: false;
    reason: "denied";
    holder: SingleWriterApplyLockHolder;
    lockPath: string;
    audit: SingleWriterApplyLockAudit;
}
export interface SingleWriterApplyLockErrorResult {
    ok: false;
    reason: "error";
    message: string;
    lockPath: string;
}
export type SingleWriterApplyLockResult<T> = SingleWriterApplyLockSuccessResult<T> | SingleWriterApplyLockDeniedResult | SingleWriterApplyLockErrorResult;
export declare function resolveSingleWriterApplyLockPath(projectDir: string, rootDirName?: string, lockFileName?: string): string;
export declare class SingleWriterApplyLock {
    private readonly lockPath;
    private readonly sessionID;
    private readonly staleAfterMs;
    private readonly pid;
    private readonly now;
    constructor(options: SingleWriterApplyLockOptions);
    withLock<T>(work: () => Promise<T> | T): Promise<SingleWriterApplyLockResult<T>>;
    private acquire;
    private release;
}
