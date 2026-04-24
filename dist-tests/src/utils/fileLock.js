/**
 * File Lock Manager - v3.4.1
 * Prevents concurrent writes to same file
 */
export class FileLockManager {
    locks = new Map();
    lockTimeout;
    constructor(lockTimeoutMs = 30000) {
        this.lockTimeout = lockTimeoutMs;
    }
    /**
     * Acquire lock on file
     */
    async acquireLock(filePath, clientId, operation) {
        const normalizedPath = this.normalizePath(filePath);
        const existingLock = this.locks.get(normalizedPath);
        if (existingLock) {
            return {
                acquired: false,
                error: `File locked by ${existingLock.operation} (client: ${existingLock.clientId})`,
                lockedBy: existingLock.clientId,
            };
        }
        // Create lock with auto-release timeout
        const timeout = setTimeout(() => {
            this.releaseLock(filePath, clientId);
            console.warn(`⚠️  Lock auto-released for ${normalizedPath} (timeout)`);
        }, this.lockTimeout);
        this.locks.set(normalizedPath, {
            clientId,
            operation,
            timestamp: Date.now(),
            timeout,
        });
        return { acquired: true };
    }
    /**
     * Release lock on file
     */
    releaseLock(filePath, clientId) {
        const normalizedPath = this.normalizePath(filePath);
        const lock = this.locks.get(normalizedPath);
        if (!lock) {
            return false; // No lock exists
        }
        if (lock.clientId !== clientId) {
            return false; // Lock owned by different client
        }
        clearTimeout(lock.timeout);
        this.locks.delete(normalizedPath);
        return true;
    }
    /**
     * Check if file is locked
     */
    isLocked(filePath) {
        const normalizedPath = this.normalizePath(filePath);
        return this.locks.has(normalizedPath);
    }
    /**
     * Get lock info
     */
    getLockInfo(filePath) {
        const normalizedPath = this.normalizePath(filePath);
        return this.locks.get(normalizedPath) || null;
    }
    /**
     * Force release lock (admin only)
     */
    forceRelease(filePath) {
        const normalizedPath = this.normalizePath(filePath);
        const lock = this.locks.get(normalizedPath);
        if (lock) {
            clearTimeout(lock.timeout);
            this.locks.delete(normalizedPath);
            return true;
        }
        return false;
    }
    /**
     * Release all locks for client
     */
    releaseAllForClient(clientId) {
        let count = 0;
        for (const [path, lock] of this.locks.entries()) {
            if (lock.clientId === clientId) {
                clearTimeout(lock.timeout);
                this.locks.delete(path);
                count++;
            }
        }
        return count;
    }
    /**
     * Get all active locks
     */
    getActiveLocks() {
        return Array.from(this.locks.entries()).map(([path, info]) => ({
            path,
            info,
        }));
    }
    /**
     * Clear all locks
     */
    clearAll() {
        for (const lock of this.locks.values()) {
            clearTimeout(lock.timeout);
        }
        this.locks.clear();
    }
    /**
     * Normalize path for consistent comparison
     */
    normalizePath(filePath) {
        return filePath.replace(/\\/g, '/').toLowerCase();
    }
}
/**
 * Global lock manager instance
 */
export const globalLockManager = new FileLockManager();
//# sourceMappingURL=fileLock.js.map