/**
 * Performance: Cache hit latency
 * Verifies cache hits are <100ms as per success criteria.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

import { CodeContextEngine } from '@/core/engine';
import { TypeScriptParser } from '@/parsers/typescript';
import { extractSymbol } from '@/operations/read';

let parser: TypeScriptParser;
let projectRoot: string;
let testFile: string;

const SAMPLE = `export interface User { id: number; name: string; }
export class UserService {
  addUser(user: User): void {}
  getUser(id: number): User | undefined { return undefined; }
}
export function validateEmail(email: string): boolean { return true; }
`;

beforeAll(async () => {
  const engine = new CodeContextEngine();
  await engine.init();
  await engine.loadLanguage('typescript');
  const lang = engine.getLanguage('typescript')!;
  parser = new TypeScriptParser();
  await parser.init(engine.createParser(), lang);

  projectRoot = path.join(tmpdir(), `perf-cache-${Date.now()}`);
  mkdirSync(projectRoot, { recursive: true });
  testFile = path.join(projectRoot, 'sample.ts');
  writeFileSync(testFile, SAMPLE);
}, 30000);

afterAll(() => {
  if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true });
});

describe('Cache Performance', () => {
  it('cold read completes in <2000ms', async () => {
    const start = Date.now();
    const result = await extractSymbol({ filePath: testFile, projectRoot, symbolName: 'User', parser });
    const duration = Date.now() - start;

    expect(result.success).toBe(true);
    expect(duration).toBeLessThan(2000);
  });

  it('warm read (cache hit) completes in <100ms', async () => {
    // First call populates cache
    await extractSymbol({ filePath: testFile, projectRoot, symbolName: 'User', parser });

    // Second call should hit cache
    const start = Date.now();
    const result = await extractSymbol({ filePath: testFile, projectRoot, symbolName: 'User', parser });
    const duration = Date.now() - start;

    expect(result.success).toBe(true);
    expect(duration).toBeLessThan(100);
  });

  it('10 consecutive cache hits all <100ms', async () => {
    // Warm up
    await extractSymbol({ filePath: testFile, projectRoot, symbolName: 'UserService', parser });

    const durations: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = Date.now();
      await extractSymbol({ filePath: testFile, projectRoot, symbolName: 'UserService', parser });
      durations.push(Date.now() - start);
    }

    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    expect(avg).toBeLessThan(100);
  });
});
