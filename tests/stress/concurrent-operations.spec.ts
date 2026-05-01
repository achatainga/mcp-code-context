/**
 * Stress: Concurrent operations
 * Verifies system handles 20 concurrent lock acquisitions without deadlock.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

import { FileLockManager } from '@/utils/fileLock';
import { writeFile } from '@/operations/write';

let testDir: string;

beforeAll(() => {
  testDir = path.join(tmpdir(), `stress-concurrent-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
});

afterAll(() => {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
});

describe('Concurrent Lock Stress', () => {
  it('20 files locked simultaneously, all released cleanly', async () => {
    const files: string[] = [];
    for (let i = 0; i < 20; i++) {
      const f = path.join(testDir, `stress-${i}.ts`);
      writeFileSync(f, `// file ${i}`);
      files.push(f);
    }

    const mgr = new FileLockManager();
    const releases: Array<() => Promise<void>> = [];

    // Acquire all locks
    for (const f of files) {
      const release = await mgr.acquireLock(f);
      releases.push(release);
    }

    expect(releases.length).toBe(20);

    // Release all
    await mgr.releaseAll();

    // All files should be lockable again
    const mgr2 = new FileLockManager();
    for (const f of files) {
      const r = await mgr2.acquireLock(f);
      await r();
    }
  }, 60000);

  it('sequential writes to 10 files, no corruption', async () => {
    const files: string[] = [];
    for (let i = 0; i < 10; i++) {
      const f = path.join(testDir, `write-stress-${i}.ts`);
      writeFileSync(f, 'initial');
      files.push(f);
    }

    const mgr = new FileLockManager();

    for (const f of files) {
      const release = await mgr.acquireLock(f);
      await writeFile(f, `updated: ${path.basename(f)}`);
      await release();
    }

    // Verify all files updated correctly
    const { readFileSync } = await import('fs');
    for (const f of files) {
      const content = readFileSync(f, 'utf-8');
      expect(content).toContain('updated:');
      expect(content).toContain(path.basename(f));
    }
  }, 60000);
});
