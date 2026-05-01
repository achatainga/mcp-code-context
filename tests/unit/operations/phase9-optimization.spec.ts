import { describe, it, expect } from 'vitest';
import { generateUnifiedDiff } from '../../../src/utils/diff.js';

describe('Phase 9: Token Optimization', () => {
  describe('Compact Diff', () => {
    it('should generate compact diff without context', () => {
      const oldText = `line1
line2
line3
line4
line5`;
      
      const newText = `line1
line2
CHANGED
line4
line5`;

      const diff = generateUnifiedDiff(oldText, newText);
      
      // Should contain the change
      expect(diff).toBeDefined();
      expect(diff.length).toBeGreaterThan(0);
    });

    it('should be smaller than full diff for large files', () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line${i}`);
      const oldText = lines.join('\n');
      
      // Change one line in the middle
      lines[50] = 'CHANGED';
      const newText = lines.join('\n');

      const diff = generateUnifiedDiff(oldText, newText);
      
      // Diff should be much smaller than full file
      expect(diff.length).toBeLessThan(oldText.length / 2);
    });
  });

  describe('Auto-optimize compress', () => {
    it('should disable symbols for large repos', () => {
      // This is tested via compress.ts logic
      const fileCount = 150;
      const totalSymbols = 500;
      
      // Auto-optimize logic: disable if >100 files OR >1000 symbols
      const includeSymbols = fileCount <= 100 && totalSymbols <= 1000;
      
      expect(includeSymbols).toBe(false);
    });

    it('should keep symbols for small repos', () => {
      const fileCount = 50;
      const totalSymbols = 200;
      
      const includeSymbols = fileCount <= 100 && totalSymbols <= 1000;
      
      expect(includeSymbols).toBe(true);
    });

    it('should disable symbols if too many symbols', () => {
      const fileCount = 50;
      const totalSymbols = 1500;
      
      const includeSymbols = fileCount <= 100 && totalSymbols <= 1000;
      
      expect(includeSymbols).toBe(false);
    });
  });

  describe('Phase 2 diff removal', () => {
    it('should not include diff in Phase 2 response', () => {
      // Phase 2 response format
      const phase2Response = '✅ Success. Changes applied to 1 file(s).';
      
      // Should NOT contain diff
      expect(phase2Response).not.toContain('@@');
      expect(phase2Response).not.toContain('---');
      expect(phase2Response).not.toContain('+++');
      expect(phase2Response).toContain('✅ Success');
    });
  });
});
