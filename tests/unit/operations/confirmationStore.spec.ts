import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfirmationStore } from '@/operations/confirmationStore';
import { existsSync, rmSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

describe('ConfirmationStore SQLite Recovery', () => {
  let projectRoot: string;
  let testSessionId: string;

  beforeEach(() => {
    projectRoot = path.join(tmpdir(), `test-confirmation-${Date.now()}`);
    testSessionId = `test-sess-${Date.now()}`;
  });

  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('should store in SQLite and recover after memory loss (re-instantiation)', async () => {
    const store = new ConfirmationStore(testSessionId, projectRoot);
    
    const token = store.storePending({
      filePath: 'test.ts',
      operation: 'write_file_surgical',
      symbolName: 'myFunc',
      newContent: 'function myFunc() {}',
      diff: 'some diff content',
      originalHash: 'abcdef123456',
      pendingWrites: [{ filePath: 'other.ts', newContent: 'other content' }]
    });

    expect(token).toBeDefined();

    // Verify it is in memory
    expect(store.hasPending(token)).toBe(true);

    // Wait for the async fire-and-forget storePending to finish writing to SQLite
    await new Promise(resolve => setTimeout(resolve, 250));

    // Simulate server crash/memory loss by creating a new ConfirmationStore instance pointing to the same DB
    const newStore = new ConfirmationStore(testSessionId, projectRoot);

    // It should not be in memory anymore since it is a new instance with empty Map
    expect(newStore.hasPending(token)).toBe(false);

    // But consumePending should query SQLite and recover it successfully
    const recovered = await newStore.consumePending(token);
    expect(recovered).not.toBeNull();
    expect(recovered!.filePath).toContain('test.ts');
    expect(recovered!.symbolName).toBe('myFunc');
    expect(recovered!.newContent).toBe('function myFunc() {}');
    expect(recovered!.originalHash).toBe('abcdef123456');
    expect(recovered!.pendingWrites).toBeDefined();
    expect(recovered!.pendingWrites![0].filePath).toBe('other.ts');
    expect(recovered!.pendingWrites![0].newContent).toBe('other content');

    // Trying to consume it again should return null since it was deleted upon consumption
    const consumedAgain = await newStore.consumePending(token);
    expect(consumedAgain).toBeNull();
  });
});
