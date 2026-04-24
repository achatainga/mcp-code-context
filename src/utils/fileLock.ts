/**
 * File Lock Manager - v3.4.1
 * Prevents concurrent writes to same file
 */

interface LockInfo {
  clientId: string;
  operation: string;
  timestamp: number;
  timeout: NodeJS.Timeout;
}

export class FileLockManager {
  private locks: Map<string, LockInfo> = new Map();
  private readonly lockTimeout: number;

  constructor(lockTimeoutMs: number = 30000) {
    this.lockTimeout = lockTimeoutMs;
  }

  /**
   * Acquire lock on file
   */
  async acquireLock(
    filePath: string,
    clientId: string,
    operation: string
  ): Promise<{ acquired: boolean; error?: string; lockedBy?: string }> {
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
  releaseLock(filePath: string, clientId: string): boolean {
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
  isLocked(filePath: string): boolean {
    const normalizedPath = this.normalizePath(filePath);
    return this.locks.has(normalizedPath);
  }

  /**
   * Get lock info
   */
  getLockInfo(filePath: string): LockInfo | null {
    const normalizedPath = this.normalizePath(filePath);
    return this.locks.get(normalizedPath) || null;
  }

  /**
   * Force release lock (admin only)
   */
  forceRelease(filePath: string): boolean {
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
  releaseAllForClient(clientId: string): number {
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
  getActiveLocks(): Array<{ path: string; info: LockInfo }> {
    return Array.from(this.locks.entries()).map(([path, info]) => ({
      path,
      info,
    }));
  }

  /**
   * Clear all locks
   */
  clearAll(): void {
    for (const lock of this.locks.values()) {
      clearTimeout(lock.timeout);
    }
    this.locks.clear();
  }

  /**
   * Normalize path for consistent comparison
   */
  private normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/').toLowerCase();
  }
}

/**
 * Global lock manager instance
 */
export const globalLockManager = new FileLockManager();
