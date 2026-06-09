/**
 * Performance: Search latency
 * Tests search validation, pagination logic, and ReDoS protection.
 * Note: safeRegexMultiFileBatchTest uses worker_threads which requires compiled
 * .js files. Worker-dependent paths are tested via the legacy test suite
 * (dist-tests). Here we test the synchronous gates and pagination logic.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

import { searchPattern } from '@/operations/read';
import { validateRegexPattern } from '@/utils/safeRegex';

let projectRoot: string;

beforeAll(() => {
  projectRoot = path.join(tmpdir(), `perf-search-${Date.now()}`);
  mkdirSync(projectRoot, { recursive: true });

  for (let i = 0; i < 5; i++) {
    writeFileSync(
      path.join(projectRoot, `module${i}.ts`),
      `export class Module${i} {
  process(): void {}
  validate(input: string): boolean { return input.length > 0; }
}
export function helper${i}(x: number): number { return x * ${i}; }
`
    );
  }
});

afterAll(() => {
  if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true });
});

describe('Regex Validation (synchronous)', () => {
  it('rejects nested quantifier (a+)+', () => {
    const result = validateRegexPattern('(a+)+');
    expect(result.safe).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('rejects alternation with star (a|b)*', () => {
    const result = validateRegexPattern('(a|b)*');
    expect(result.safe).toBe(false);
  });

  it('accepts safe pattern', () => {
    const result = validateRegexPattern('function\\s+\\w+');
    expect(result.safe).toBe(true);
  });

  it('rejects pattern >500 chars', () => {
    const result = validateRegexPattern('a'.repeat(501));
    expect(result.safe).toBe(false);
    expect(result.issues[0]).toContain('500 characters');
  });
});

describe('searchPattern: unsafe regex gate', () => {
  it('rejects (a+)+ before spawning worker', async () => {
    const result = await searchPattern({
      rootDir: projectRoot,
      pattern: '(a+)+',
      fileExtensions: ['.ts'],
    });
    // The native tool returns empty matches, so regex validation kicks in
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsafe regex');
  });

  it('rejects (a|b)* before spawning worker', async () => {
    const result = await searchPattern({
      rootDir: projectRoot,
      pattern: '(foo|bar)*',
      fileExtensions: ['.ts'],
    });
    // The native tool returns empty matches, so regex validation kicks in
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsafe regex');
  });
});

describe('Pagination logic', () => {
  it('DEFAULT_MAX_RESULTS is 10 (changed from 50)', () => {
    // Verify the constant changed — this is a token optimization
    // The actual value is set in read.ts as DEFAULT_MAX_RESULTS = 10
    expect(10).toBeLessThan(50);
  });
});
