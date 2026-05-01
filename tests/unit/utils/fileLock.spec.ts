import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileLockManager } from '@/utils/fileLock';
import path from 'path';
import { tmpdir } from 'os';
import { writeFileSync, existsSync, unlinkSync } from 'fs';

describe('FileLockManager', () => {
  let lockManager: FileLockManager;
  let testFile: string;
  const createdFiles: string[] = [];

  function createTempFile(name?: string): string {
    const filePath = path.join(tmpdir(), name ?? `test-lock-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    writeFileSync(filePath, '');
    createdFiles.push(filePath);
    return filePath;
  }

  beforeEach(() => {
    lockManager = new FileLockManager();
    testFile = createTempFile();
  });

  afterEach(() => {
    // Clean up temp files
    for (const f of createdFiles) {
      try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
    }
    createdFiles.length = 0;
  });

  describe('acquireLock', () => {
    it('should acquire lock successfully', async () => {
      const release = await lockManager.acquireLock(testFile);
      expect(release).toBeTypeOf('function');
      await release();
    });

    it('should prevent concurrent locks on same file', async () => {
      const release1 = await lockManager.acquireLock(testFile);

      await expect(
        lockManager.acquireLock(testFile)
      ).rejects.toThrow();

      await release1();
    });

    it('should allow lock after release', async () => {
      const release1 = await lockManager.acquireLock(testFile);
      await release1();

      const release2 = await lockManager.acquireLock(testFile);
      expect(release2).toBeTypeOf('function');
      await release2();
    });
  });

  describe('isLocked', () => {
    it('should return true for locked file', async () => {
      const release = await lockManager.acquireLock(testFile);

      const locked = await lockManager.isLocked(testFile);
      expect(locked).toBe(true);

      await release();
    });

    it('should return false for unlocked file', async () => {
      const locked = await lockManager.isLocked(testFile);
      expect(locked).toBe(false);
    });
  });

  describe('path normalization', () => {
    it('should normalize paths consistently', async () => {
      // Use the same real file with forward/back slashes
      const forwardSlash = testFile.replace(/\\/g, '/');
      const backSlash = testFile.replace(/\//g, '\\');

      const release1 = await lockManager.acquireLock(forwardSlash);

      // Same file with different slash style should be recognized as locked
      await expect(
        lockManager.acquireLock(backSlash)
      ).rejects.toThrow();

      await release1();
    });
  });

  describe('releaseAll', () => {
    it('should release all locks', async () => {
      const file1 = createTempFile('test-release-1.txt');
      const file2 = createTempFile('test-release-2.txt');

      await lockManager.acquireLock(file1);
      await lockManager.acquireLock(file2);

      await lockManager.releaseAll();

      // Should be able to acquire again
      const release1 = await lockManager.acquireLock(file1);
      const release2 = await lockManager.acquireLock(file2);

      expect(release1).toBeTypeOf('function');
      expect(release2).toBeTypeOf('function');

      await release1();
      await release2();
    });
  });
});
