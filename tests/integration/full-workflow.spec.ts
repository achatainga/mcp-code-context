/**
 * Integration: Full Write Workflow
 * Tests the complete read → write → rollback cycle using real files.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

import { CodeContextEngine } from '@/core/engine';
import { TypeScriptParser } from '@/parsers/typescript';
import { extractSymbol, readLines, searchPattern } from '@/operations/read';
import { replaceSymbol, insertCode, removeSymbol, writeFile } from '@/operations/write';
import { BackupManager } from '@/utils/backupManager';

// ─── Setup ───────────────────────────────────────────────────────────────────

let parser: TypeScriptParser;
let projectRoot: string;
let testFile: string;

const SAMPLE_CODE = `export interface User {
  id: number;
  name: string;
  email: string;
}

export class UserService {
  private users: User[] = [];

  addUser(user: User): void {
    this.users.push(user);
  }

  getUser(id: number): User | undefined {
    return this.users.find(u => u.id === id);
  }

  getAllUsers(): User[] {
    return this.users;
  }
}

export function validateEmail(email: string): boolean {
  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email);
}
`;

beforeAll(async () => {
  const engine = new CodeContextEngine();
  await engine.init();
  await engine.loadLanguage('typescript');
  const lang = engine.getLanguage('typescript')!;
  parser = new TypeScriptParser();
  await parser.init(engine.createParser(), lang);

  projectRoot = path.join(tmpdir(), `integration-test-${Date.now()}`);
  mkdirSync(projectRoot, { recursive: true });
  testFile = path.join(projectRoot, 'sample.ts');
  writeFileSync(testFile, SAMPLE_CODE);
}, 30000);

afterAll(() => {
  if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true });
});

// ─── Read Operations ──────────────────────────────────────────────────────────

describe('Read Operations', () => {
  it('extractSymbol: reads interface', async () => {
    const result = await extractSymbol({ filePath: testFile, projectRoot, symbolName: 'User', parser });
    expect(result.success).toBe(true);
    expect(result.content).toContain('interface User');
  });

  it('extractSymbol: reads class', async () => {
    const result = await extractSymbol({ filePath: testFile, projectRoot, symbolName: 'UserService', parser });
    expect(result.success).toBe(true);
    expect(result.content).toContain('class UserService');
  });

  it('extractSymbol: reads function', async () => {
    const result = await extractSymbol({ filePath: testFile, projectRoot, symbolName: 'validateEmail', parser });
    expect(result.success).toBe(true);
    expect(result.content).toContain('validateEmail');
  });

  it('extractSymbol: returns error for missing symbol', async () => {
    const result = await extractSymbol({ filePath: testFile, projectRoot, symbolName: 'nonExistent', parser });
    expect(result.success).toBe(false);
    expect(result.error).toContain('nonExistent');
  });

  it('readLines: reads specific range', async () => {
    const result = await readLines({ filePath: testFile, startLine: 1, endLine: 5 });
    expect(result.success).toBe(true);
    expect(result.content).toContain('interface User');
  });

  it('readLines: finds pattern via line range', async () => {
    // aroundPattern uses worker_threads which can't resolve .ts in Vitest context
    // Test line-range mode instead (same function, different code path)
    const result = await readLines({ filePath: testFile, startLine: 23, endLine: 26 });
    expect(result.success).toBe(true);
    expect(result.content).toContain('validateEmail');
  });

  it('searchPattern: rejects unsafe regex (synchronous path)', async () => {
    // searchPattern's worker path can't resolve .ts in Vitest context.
    // Test the synchronous validation gate instead.
    const result = await searchPattern({
      rootDir: projectRoot,
      pattern: '(a+)+',
      fileExtensions: ['.ts'],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsafe regex');
  });
});

// ─── Write → Read Cycle ───────────────────────────────────────────────────────

describe('Write → Read Cycle', () => {
  it('replaceSymbol: replaces function and content is updated on disk', async () => {
    const newFn = `export function validateEmail(email: string): boolean {
  // Updated implementation
  return email.includes('@') && email.includes('.');
}`;

    const result = await replaceSymbol({
      filePath: testFile,
      projectRoot,
      symbolName: 'validateEmail',
      newContent: newFn,
      parser,
    });

    expect(result.success).toBe(true);
    expect(result.newContent).toContain('Updated implementation');
    expect(result.diff).toBeDefined();

    // Write to disk
    await writeFile(testFile, result.newContent!);

    // Verify on disk
    const onDisk = readFileSync(testFile, 'utf-8');
    expect(onDisk).toContain('Updated implementation');

    // Restore original
    writeFileSync(testFile, SAMPLE_CODE);
  });

  it('insertCode: inserts after anchor symbol', async () => {
    const newMethod = `  deleteUser(id: number): void {
    this.users = this.users.filter(u => u.id !== id);
  }`;

    const result = await insertCode({
      filePath: testFile,
      projectRoot,
      code: newMethod,
      anchorSymbol: 'getAllUsers',
      position: 'after',
      parser,
    });

    expect(result.success).toBe(true);
    expect(result.newContent).toContain('deleteUser');

    // Write and verify
    await writeFile(testFile, result.newContent!);
    const onDisk = readFileSync(testFile, 'utf-8');
    expect(onDisk).toContain('deleteUser');

    // Restore
    writeFileSync(testFile, SAMPLE_CODE);
  });

  it('removeSymbol: removes function', async () => {
    const result = await removeSymbol({
      filePath: testFile,
      projectRoot,
      symbolName: 'validateEmail',
      parser,
    });

    expect(result.success).toBe(true);
    expect(result.newContent).not.toContain('function validateEmail');

    // Write and verify
    await writeFile(testFile, result.newContent!);
    const onDisk = readFileSync(testFile, 'utf-8');
    expect(onDisk).not.toContain('function validateEmail');

    // Restore
    writeFileSync(testFile, SAMPLE_CODE);
  });
});

// ─── Backup → Rollback Cycle ──────────────────────────────────────────────────

describe('Backup → Rollback Cycle', () => {
  it('creates backup, modifies file, rolls back to original', async () => {
    const original = readFileSync(testFile, 'utf-8');

    // Backup
    await BackupManager.createBackup(testFile, projectRoot);

    // Modify
    writeFileSync(testFile, '// completely replaced');
    expect(readFileSync(testFile, 'utf-8')).toBe('// completely replaced');

    // Rollback
    const rollback = await BackupManager.rollback(testFile, projectRoot);
    expect(rollback.success).toBe(true);

    // Verify restored
    const restored = readFileSync(testFile, 'utf-8');
    expect(restored).toBe(original);
  });

  it('multi-step rollback restores correct version', async () => {
    writeFileSync(testFile, 'version 1');
    await BackupManager.createBackup(testFile, projectRoot);

    writeFileSync(testFile, 'version 2');
    await BackupManager.createBackup(testFile, projectRoot);

    writeFileSync(testFile, 'version 3');

    // Roll back 2 steps → should get version 1
    const rollback = await BackupManager.rollback(testFile, projectRoot, 2);
    expect(rollback.success).toBe(true);
    expect(readFileSync(testFile, 'utf-8')).toBe('version 1');

    // Restore
    writeFileSync(testFile, SAMPLE_CODE);
  });
});

// ─── Security Boundary ────────────────────────────────────────────────────────

describe('Security Boundary', () => {
  it('replaceSymbol: rejects path outside projectRoot', async () => {
    const outsidePath = path.join(tmpdir(), 'outside.ts');
    writeFileSync(outsidePath, 'const x = 1;');

    const result = await replaceSymbol({
      filePath: outsidePath,
      projectRoot,
      symbolName: 'x',
      newContent: 'const x = 2;',
      parser,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('outside project boundary');

    rmSync(outsidePath);
  });

  it('extractSymbol: rejects path traversal', async () => {
    const result = await extractSymbol({
      filePath: path.join(projectRoot, '..', '..', 'etc', 'passwd'),
      projectRoot,
      symbolName: 'root',
      parser,
    });

    expect(result.success).toBe(false);
  });
});
