/**
 * File Lock Manager - v3.5.1
 * Prevents concurrent writes to same file
 */
interface LockInfo {
    clientId: string;
    operation: string;
    timestamp: number;
    timeout: NodeJS.Timeout;
}
export declare class FileLockManager {
    private locks;
    private readonly lockTimeout;
    constructor(lockTimeoutMs?: number);
    /**
     * Acquire lock on file
     */
    acquireLock(filePath: string, clientId: string, operation: string): Promise<{
        acquired: boolean;
        error?: string;
        lockedBy?: string;
    }>;
    /**
     * Release lock on file
     */
    releaseLock(filePath: string, clientId: string): boolean;
    /**
     * Check if file is locked
     */
    isLocked(filePath: string): boolean;
    /**
     * Get lock info
     */
    getLockInfo(filePath: string): LockInfo | null;
    /**
     * Force release lock (admin only)
     */
    forceRelease(filePath: string): boolean;
    /**
     * Release all locks for client
     */
    releaseAllForClient(clientId: string): number;
    /**
     * Get all active locks
     */
    getActiveLocks(): Array<{
        path: string;
        info: LockInfo;
    }>;
    /**
     * Clear all locks
     */
    clearAll(): void;
    /**
     * Normalize path for consistent comparison
     */
    private normalizePath;
}
/**
 * Global lock manager instance
 */
export declare const globalLockManager: FileLockManager;
export {};
