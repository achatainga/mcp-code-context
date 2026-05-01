/**
 * File Lock Manager - v3.6.0
 * Filesystem-based locks for multi-process safety
 */
export declare class FileLockManager {
    private lockDir;
    private activeLocks;
    constructor();
    acquireLock(filePath: string, timeoutMs?: number): Promise<() => Promise<void>>;
    isLocked(filePath: string): Promise<boolean>;
    releaseAll(): Promise<void>;
}
export declare const globalLockManager: FileLockManager;
