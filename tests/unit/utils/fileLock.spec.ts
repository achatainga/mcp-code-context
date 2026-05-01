import { describe, it, expect, beforeEach } from 'vitest';
import { FileLockManager } from '@/utils/fileLock';
import path from 'path';
import { tmpdir } from 'os';

describe('FileLockManager', () => {
  let lockManager: FileLockManager;
  let testFile: string;

  beforeEach(() => {
    lockManager = new FileLockManager();
    testFile = path.join(tmpdir(), `test-${Date.now()}.txt`);
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
      const path1 = 'C:\\test\\file.txt';
      const path2 = 'C:/test/file.txt';
      
      const release1 = await lockManager.acquireLock(path1);
      
      // Should recognize as same file
      await expect(
        lockManager.acquireLock(path2)
      ).rejects.toThrow();
      
      await release1();
    });
  });

  describe('releaseAll', () => {
    it('should release all locks', async () => {
      const file1 = path.join(tmpdir(), 'test1.txt');
      const file2 = path.join(tmpdir(), 'test2.txt');
      
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
