export interface InstanceLockInfo {
    pid: number;
    startedAt: number;
}
export interface InstanceLockResult {
    ok: boolean;
    reason: "acquired" | "already_running" | "error";
    holder?: InstanceLockInfo;
}
export declare function tryReadInstanceLock(lockPath: string): InstanceLockInfo | null;
export declare function releaseInstanceLock(lockPath: string): void;
export declare function tryAcquireInstanceLock(lockPath: string): InstanceLockResult;
