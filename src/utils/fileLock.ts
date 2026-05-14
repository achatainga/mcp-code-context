/**
 * File Lock Manager - v3.6.2
 * Filesystem-based locks for multi-process safety
 */

import lockfile from 'proper-lockfile';
import { tmpdir } from 'os';
import { mkdirSync, existsSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { LOCK_TIMEOUT_MS, LOCK_RETRY_COUNT, LOCK_RETRY_MIN_MS, LOCK_RETRY_MAX_MS, LOCK_RETRY_FACTOR, HASH_LENGTH } from './constants.js';

/**
 * Manages filesystem-based locks for multi-process safety.
 * Locks are stored in OS temp directory to prevent conflicts.
 */
export class FileLockManager {
  private lockDir: string;
  private activeLocks: Map<string, () => Promise<void>> = new Map();

  /**
   * Creates a new FileLockManager instance.
   * Initializes lock directory in OS temp with project-specific hash.
   */
  constructor() {
    const projectHash = crypto.createHash('md5')
      .update(process.cwd())
      .digest('hex')
      .substring(0, HASH_LENGTH);
    
    this.lockDir = path.join(tmpdir(), `mcp-locks-${projectHash}`);
    
    if (!existsSync(this.lockDir)) {
      mkdirSync(this.lockDir, { recursive: true });
    }
  }

  /**
   * Acquires an exclusive lock on a file.
   * 
   * @param filePath - Absolute path to file to lock
   * @param timeoutMs - Stale lock timeout in milliseconds (default: 30000)
   * @returns Release function to unlock the file
   * @throws Error if lock cannot be acquired after retries
   */
  async acquireLock(filePath: string, timeoutMs: number = LOCK_TIMEOUT_MS): Promise<() => Promise<void>> {
    const normalizedPath = path.resolve(filePath);
    
    try {
      const release = await lockfile.lock(normalizedPath, {
        stale: timeoutMs,
        retries: {
          retries: LOCK_RETRY_COUNT,
          minTimeout: LOCK_RETRY_MIN_MS,
          maxTimeout: LOCK_RETRY_MAX_MS,
          factor: LOCK_RETRY_FACTOR
        },
        lockfilePath: path.join(
          this.lockDir,
          `${crypto.createHash('md5').update(normalizedPath).digest('hex')}.lock`
        )
      });

      this.activeLocks.set(normalizedPath, release);

      return async () => {
        await release();
        this.activeLocks.delete(normalizedPath);
      };
    } catch (error: any) {
      throw new Error(`Failed to acquire lock for "${filePath}": ${error.message || String(error)}`);
    }
  }

  /**
   * Checks if a file is currently locked.
   * 
   * @param filePath - Absolute path to file
   * @returns True if file is locked, false otherwise
   */
  async isLocked(filePath: string): Promise<boolean> {
    const normalizedPath = path.resolve(filePath);
    
    try {
      const lockfilePath = path.join(
        this.lockDir,
        `${crypto.createHash('md5').update(normalizedPath).digest('hex')}.lock`
      );
      
      return await lockfile.check(normalizedPath, { lockfilePath });
    } catch {
      return false;
    }
  }

  /**
   * Releases all active locks managed by this instance.
   */
  async releaseAll(): Promise<void> {
    const releases = Array.from(this.activeLocks.values());
    await Promise.all(releases.map(release => release()));
    this.activeLocks.clear();
  }
}

export const globalLockManager = new FileLockManager();
