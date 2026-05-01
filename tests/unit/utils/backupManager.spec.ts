import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BackupManager } from '@/utils/backupManager';
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

describe('BackupManager', () => {
  let testDir: string;
  let testFile: string;
  let projectRoot: string;

  beforeEach(() => {
    testDir = path.join(tmpdir(), `test-backup-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    projectRoot = testDir;
    testFile = path.join(testDir, 'test.txt');
    writeFileSync(testFile, 'original content');
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('createBackup', () => {
    it('should create backup successfully', async () => {
      await BackupManager.createBackup(testFile, projectRoot);

      const backups = await BackupManager.listBackups(testFile, projectRoot);
      expect(backups.length).toBe(1);
    });

    it('should preserve file content in backup', async () => {
      const originalContent = 'test content';
      writeFileSync(testFile, originalContent);

      await BackupManager.createBackup(testFile, projectRoot);

      const backups = await BackupManager.listBackups(testFile, projectRoot);
      const backupContent = readFileSync(backups[0], 'utf-8');

      expect(backupContent).toBe(originalContent);
    });

    it('should create multiple backups', async () => {
      await BackupManager.createBackup(testFile, projectRoot);
      writeFileSync(testFile, 'modified 1');
      await BackupManager.createBackup(testFile, projectRoot);
      writeFileSync(testFile, 'modified 2');
      await BackupManager.createBackup(testFile, projectRoot);

      const backups = await BackupManager.listBackups(testFile, projectRoot);
      expect(backups.length).toBe(3);
    });
  });

  describe('rollback', () => {
    it('should restore file from backup', async () => {
      const originalContent = 'original';
      writeFileSync(testFile, originalContent);
      await BackupManager.createBackup(testFile, projectRoot);

      writeFileSync(testFile, 'modified');

      const result = await BackupManager.rollback(testFile, projectRoot);
      expect(result.success).toBe(true);

      const restoredContent = readFileSync(testFile, 'utf-8');
      expect(restoredContent).toBe(originalContent);
    });

    it('should return failure if no backups exist', async () => {
      // BackupManager returns { success: false } rather than throwing
      const result = await BackupManager.rollback(testFile, projectRoot);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('enforceBackupLimit', () => {
    it('should keep only 5 most recent backups', async () => {
      for (let i = 0; i < 7; i++) {
        writeFileSync(testFile, `content ${i}`);
        await BackupManager.createBackup(testFile, projectRoot);
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const backups = await BackupManager.listBackups(testFile, projectRoot);
      expect(backups.length).toBeLessThanOrEqual(5);
    });
  });

  describe('clean', () => {
    it('should remove all backups for project', async () => {
      await BackupManager.createBackup(testFile, projectRoot);
      await BackupManager.createBackup(testFile, projectRoot);

      // API is clean(projectRoot) — removes all backups for the project
      const result = await BackupManager.clean(projectRoot);
      expect(result.success).toBe(true);

      const backups = await BackupManager.listBackups(testFile, projectRoot);
      expect(backups.length).toBe(0);
    });
  });
});
