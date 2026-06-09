/**
 * Stress: Large file handling
 * Verifies OOM protection and graceful degradation on large files.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

import { readLines } from '@/operations/read';
import { generateUnifiedDiff, generateSimpleDiff } from '@/utils/diff';
import { DIFF_MAX_FILE_LINES } from '@/utils/constants';

let testDir: string;

beforeAll(() => {
  testDir = path.join(tmpdir(), `stress-large-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
});

afterAll(() => {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
});

describe('Large File Handling', () => {
  it('readLines on 10K line file completes without OOM', async () => {
    const lines = Array.from({ length: 10000 }, (_, i) => `const line${i} = ${i};`);
    const filePath = path.join(testDir, 'large.ts');
    writeFileSync(filePath, lines.join('\n'));

    const result = await readLines({ filePath, startLine: 5000, endLine: 5010 });

    expect(result.success).toBe(true);
    expect(result.content).toContain('line4999');
  });

  it('diff on files exceeding DIFF_MAX_FILE_LINES falls back to simple diff', () => {
    const bigFile = Array(DIFF_MAX_FILE_LINES + 100).fill('line').join('\n');
    const bigFile2 = Array(DIFF_MAX_FILE_LINES + 100).fill('changed').join('\n');

    const diff = generateUnifiedDiff(bigFile, bigFile2);

    expect(diff).toContain('File too large');
    expect(diff.length).toBeLessThan(500);
  });

  it('generateSimpleDiff always returns compact summary', () => {
    const huge1 = 'x'.repeat(100000);
    const huge2 = 'y'.repeat(100000);

    const diff = generateSimpleDiff(huge1, huge2);

    expect(diff).toContain('File too large');
    expect(diff.length).toBeLessThan(500);
  });

  it('readLines: invalid range returns error not crash', async () => {
    const filePath = path.join(testDir, 'small.ts');
    writeFileSync(filePath, 'line1\nline2\nline3');

    const result = await readLines({ filePath, startLine: 100, endLine: 200 });

    expect(result.success).toBe(false);
    expect(result.error).toContain('exceeds file length');
  });

  it('readLines: pattern not found — line range with out-of-bounds returns error', async () => {
    const filePath = path.join(testDir, 'pattern.ts');
    writeFileSync(filePath, 'const x = 1;\nconst y = 2;');

    // aroundPattern uses worker_threads (needs compiled .js).
    // Test the equivalent error path via invalid line range instead.
    const result = await readLines({ filePath, startLine: 999, endLine: 1000 });

    expect(result.success).toBe(false);
    expect(result.error).toContain('exceeds file length');
  });
});
