/**
 * File Lock Manager - v3.6.0
 * Filesystem-based locks for multi-process safety
 */
/**
 * Manages filesystem-based locks for multi-process safety.
 * Locks are stored in OS temp directory to prevent conflicts.
 */
export declare class FileLockManager {
    private lockDir;
    private activeLocks;
    /**
     * Creates a new FileLockManager instance.
     * Initializes lock directory in OS temp with project-specific hash.
     */
    constructor();
    /**
     * Acquires an exclusive lock on a file.
     *
     * @param filePath - Absolute path to file to lock
     * @param timeoutMs - Stale lock timeout in milliseconds (default: 30000)
     * @returns Release function to unlock the file
     * @throws Error if lock cannot be acquired after retries
     */
    acquireLock(filePath: string, timeoutMs?: number): Promise<() => Promise<void>>;
    /**
     * Checks if a file is currently locked.
     *
     * @param filePath - Absolute path to file
     * @returns True if file is locked, false otherwise
     */
    isLocked(filePath: string): Promise<boolean>;
    /**
     * Releases all active locks managed by this instance.
     */
    releaseAll(): Promise<void>;
}
export declare const globalLockManager: FileLockManager;
