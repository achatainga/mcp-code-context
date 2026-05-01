import { describe, it, expect } from 'vitest';
import { generateUnifiedDiff, generateSimpleDiff, lcs } from '@/utils/diff';

describe('diff utils', () => {
  describe('lcs', () => {
    it('should find longest common subsequence', () => {
      const lines1 = ['a', 'b', 'c'];
      const lines2 = ['a', 'x', 'c'];
      const result = lcs(lines1, lines2);
      
      expect(result).toEqual(['a', 'c']);
    });

    it('should handle identical arrays', () => {
      const lines = ['a', 'b', 'c'];
      const result = lcs(lines, lines);
      
      expect(result).toEqual(lines);
    });

    it('should handle empty arrays', () => {
      const result = lcs([], []);
      
      expect(result).toEqual([]);
    });
  });

  describe('generateUnifiedDiff', () => {
    it('should generate diff for simple change', () => {
      const oldText = 'function hello() {\n  return "old";\n}';
      const newText = 'function hello() {\n  return "new";\n}';
      
      const diff = generateUnifiedDiff(oldText, newText);
      
      expect(diff).toContain('-');
      expect(diff).toContain('+');
      expect(diff).toContain('old');
      expect(diff).toContain('new');
    });

    it('should handle additions', () => {
      const oldText = 'line1\nline2';
      const newText = 'line1\nline2\nline3';
      
      const diff = generateUnifiedDiff(oldText, newText);
      
      expect(diff).toContain('+line3');
    });

    it('should handle deletions', () => {
      const oldText = 'line1\nline2\nline3';
      const newText = 'line1\nline3';
      
      const diff = generateUnifiedDiff(oldText, newText);
      
      expect(diff).toContain('-line2');
    });
  });

  describe('generateSimpleDiff', () => {
    it('should generate simple diff for large files', () => {
      const oldText = 'a'.repeat(10000);
      const newText = 'b'.repeat(10000);
      
      const diff = generateSimpleDiff(oldText, newText);
      
      expect(diff).toContain('File too large');
      expect(diff.length).toBeLessThan(1000);
    });

    it('should show summary for large changes', () => {
      const oldLines = Array(1000).fill('old').join('\n');
      const newLines = Array(1000).fill('new').join('\n');
      
      const diff = generateSimpleDiff(oldLines, newLines);
      
      expect(diff.length).toBeGreaterThan(0);
    });
  });

  describe('OOM protection', () => {
    it('should not crash on very large files', () => {
      const largeText1 = Array(1000).fill('line').join('\n');
      const largeText2 = Array(1000).fill('mod').join('\n');
      
      expect(() => {
        generateUnifiedDiff(largeText1, largeText2);
      }).not.toThrow();
    });

    it('should fallback to simple diff for files >5000 lines', () => {
      const lines1 = Array(6000).fill('a').join('\n');
      const lines2 = Array(6000).fill('b').join('\n');
      
      const diff = generateUnifiedDiff(lines1, lines2);
      
      expect(diff).toContain('File too large');
    });
  });
});
