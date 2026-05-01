/**
 * Integration: Multi-process Safety
 * Tests concurrent write operations don't corrupt files.
 * Uses FileLockManager to verify mutual exclusion.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

import { FileLockManager } from '@/utils/fileLock';
import { writeFile } from '@/operations/write';

let testDir: string;

beforeAll(() => {
  testDir = path.join(tmpdir(), `multi-process-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
});

afterAll(() => {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
});

describe('Concurrent File Locking', () => {
  it('two concurrent lock attempts: second waits or fails, no corruption', async () => {
    const file = path.join(testDir, 'concurrent.ts');
    writeFileSync(file, 'initial');

    const mgr1 = new FileLockManager();
    const mgr2 = new FileLockManager();

    const release1 = await mgr1.acquireLock(file);

    // Second lock on same file should fail (retries exhausted)
    await expect(mgr2.acquireLock(file)).rejects.toThrow();

    await release1();

    // After release, second manager can acquire
    const release2 = await mgr2.acquireLock(file);
    expect(release2).toBeTypeOf('function');
    await release2();
  });

  it('sequential writes produce correct final content', async () => {
    const file = path.join(testDir, 'sequential.ts');
    writeFileSync(file, 'v0');

    const mgr = new FileLockManager();

    for (let i = 1; i <= 5; i++) {
      const release = await mgr.acquireLock(file);
      await writeFile(file, `v${i}`);
      await release();
    }

    expect(readFileSync(file, 'utf-8')).toBe('v5');
  });

  it('atomic write: .tmp file is cleaned up on success', async () => {
    const file = path.join(testDir, 'atomic.ts');
    writeFileSync(file, 'original');

    await writeFile(file, 'updated');

    // .tmp should not exist after successful write
    expect(existsSync(file + '.tmp')).toBe(false);
    expect(readFileSync(file, 'utf-8')).toBe('updated');
  });

  it('releaseAll: clears all held locks', async () => {
    const file1 = path.join(testDir, 'lock1.ts');
    const file2 = path.join(testDir, 'lock2.ts');
    writeFileSync(file1, '');
    writeFileSync(file2, '');

    const mgr = new FileLockManager();
    await mgr.acquireLock(file1);
    await mgr.acquireLock(file2);

    await mgr.releaseAll();

    // Both should be acquirable again
    const mgr2 = new FileLockManager();
    const r1 = await mgr2.acquireLock(file1);
    const r2 = await mgr2.acquireLock(file2);
    expect(r1).toBeTypeOf('function');
    expect(r2).toBeTypeOf('function');
    await r1();
    await r2();
  });
});

describe('Concurrent Writes (Race Condition Prevention)', () => {
  it('10 sequential writes to same file produce correct result', async () => {
    const file = path.join(testDir, 'race.ts');
    writeFileSync(file, 'start');

    const mgr = new FileLockManager();
    const writes: Promise<void>[] = [];

    // Sequential via lock — each write waits for previous
    for (let i = 0; i < 10; i++) {
      const idx = i;
      writes.push((async () => {
        const release = await mgr.acquireLock(file);
        await writeFile(file, `write-${idx}`);
        await release();
      })());
    }

    // Run sequentially (each awaits lock)
    for (const w of writes) await w;

    // Final content should be one of the writes (last one wins)
    const content = readFileSync(file, 'utf-8');
    expect(content).toMatch(/^write-\d+$/);
  });
});
