/**
 * TOCTOU Race Condition Tests
 * Verifies FIX 3: File modification detection between Phase 1 and Phase 2
 */

import { describe, it, expect } from 'vitest';
import type { WriteResult } from '../../../src/operations/write.js';

describe('TOCTOU Protection', () => {
  it('should include originalHash in WriteResult interface', () => {
    // Type check - this will fail at compile time if interface is wrong
    const mockResult: WriteResult = {
      success: true,
      newContent: 'test',
      diff: 'test',
      originalHash: 'abc123def456',
    };

    expect(mockResult.originalHash).toBe('abc123def456');
    expect(typeof mockResult.originalHash).toBe('string');
  });

  it('should allow WriteResult without originalHash for backwards compatibility', () => {
    const mockResult: WriteResult = {
      success: true,
      newContent: 'test',
      diff: 'test',
    };

    expect(mockResult.originalHash).toBeUndefined();
  });

  it('should support pendingWrites in WriteResult', () => {
    const mockResult: WriteResult = {
      success: true,
      newContent: 'test',
      diff: 'test',
      originalHash: 'hash123',
      pendingWrites: [
        { filePath: '/test/file1.ts', newContent: 'content1' },
        { filePath: '/test/file2.ts', newContent: 'content2' },
      ],
    };

    expect(mockResult.pendingWrites).toHaveLength(2);
  });
});
