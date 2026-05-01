/**
 * File Lock Manager - v3.6.0
 * Filesystem-based locks for multi-process safety
 */

import lockfile from 'proper-lockfile';
import { tmpdir } from 'os';
import { mkdirSync, existsSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { LOCK_TIMEOUT_MS, LOCK_RETRY_COUNT, LOCK_RETRY_MIN_MS, LOCK_RETRY_MAX_MS, LOCK_RETRY_FACTOR, HASH_LENGTH } from './constants.js';

export class FileLockManager {
  private lockDir: string;
  private activeLocks: Map<string, () => Promise<void>> = new Map();

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
      throw new Error(`Could not acquire lock for ${filePath}: ${error.message}`);
    }
  }

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

  async releaseAll(): Promise<void> {
    const releases = Array.from(this.activeLocks.values());
    await Promise.all(releases.map(release => release()));
    this.activeLocks.clear();
  }
}

export const globalLockManager = new FileLockManager();
