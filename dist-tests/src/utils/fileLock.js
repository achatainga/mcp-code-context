/**
 * File Lock Manager - v3.6.0
 * Filesystem-based locks for multi-process safety
 */
import lockfile from 'proper-lockfile';
import { tmpdir } from 'os';
import { mkdirSync, existsSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
export class FileLockManager {
    lockDir;
    activeLocks = new Map();
    constructor() {
        const projectHash = crypto.createHash('md5')
            .update(process.cwd())
            .digest('hex')
            .substring(0, 8);
        this.lockDir = path.join(tmpdir(), `mcp-locks-${projectHash}`);
        if (!existsSync(this.lockDir)) {
            mkdirSync(this.lockDir, { recursive: true });
        }
    }
    async acquireLock(filePath, timeoutMs = 30000) {
        const normalizedPath = path.resolve(filePath);
        try {
            const release = await lockfile.lock(normalizedPath, {
                stale: timeoutMs,
                retries: {
                    retries: 10,
                    minTimeout: 100,
                    maxTimeout: 1000,
                    factor: 2
                },
                lockfilePath: path.join(this.lockDir, `${crypto.createHash('md5').update(normalizedPath).digest('hex')}.lock`)
            });
            this.activeLocks.set(normalizedPath, release);
            return async () => {
                await release();
                this.activeLocks.delete(normalizedPath);
            };
        }
        catch (error) {
            throw new Error(`Could not acquire lock for ${filePath}: ${error.message}`);
        }
    }
    async isLocked(filePath) {
        const normalizedPath = path.resolve(filePath);
        try {
            const lockfilePath = path.join(this.lockDir, `${crypto.createHash('md5').update(normalizedPath).digest('hex')}.lock`);
            return await lockfile.check(normalizedPath, { lockfilePath });
        }
        catch {
            return false;
        }
    }
    async releaseAll() {
        const releases = Array.from(this.activeLocks.values());
        await Promise.all(releases.map(release => release()));
        this.activeLocks.clear();
    }
}
export const globalLockManager = new FileLockManager();
//# sourceMappingURL=fileLock.js.map