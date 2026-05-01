/**
 * Diff Utilities - v3.6.1
 * Uses diff-match-patch for efficient diffing
 */

import DiffMatchPatch from 'diff-match-patch';
import { DIFF_MAX_FILE_LINES } from './constants.js';

const dmp = new DiffMatchPatch();
const COMPACT_DIFF_THRESHOLD = 2048;

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  lineNumber?: number;
}

/**
 * Generates a unified diff using Myers algorithm.
 * Falls back to simple diff for files exceeding line limit.
 * 
 * @param oldText - Original file content
 * @param newText - Modified file content
 * @returns Unified diff in patch format
 */
export function generateUnifiedDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  if (oldLines.length > DIFF_MAX_FILE_LINES || newLines.length > DIFF_MAX_FILE_LINES) {
    return generateSimpleDiff(oldText, newText);
  }

  const diffs = dmp.diff_main(oldText, newText);
  dmp.diff_cleanupSemantic(diffs);

  const patch = dmp.patch_make(oldText, diffs);
  return dmp.patch_toText(patch);
}

/**
 * Generates a simple diff summary for large files.
 * 
 * @param oldText - Original file content
 * @param newText - Modified file content
 * @returns Simple line count summary
 */
export function generateSimpleDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  return `File too large for detailed diff.
Old: ${oldLines.length} lines
New: ${newLines.length} lines
Changed: ${Math.abs(oldLines.length - newLines.length)} lines`;
}

/**
 * Generates a compact diff showing only changes (no context).
 * 
 * @param oldText - Original file content
 * @param newText - Modified file content
 * @returns Compact diff with + and - prefixes
 */
export function generateCompactDiff(oldText: string, newText: string): string {
  const diffs = dmp.diff_main(oldText, newText);
  dmp.diff_cleanupSemantic(diffs);

  const compactLines: string[] = [];
  
  for (const [op, text] of diffs) {
    if (op === 0) continue;
    
    const prefix = op === 1 ? '+ ' : '- ';
    const lines = text.split('\n').filter(line => line.trim().length > 0);
    
    for (const line of lines) {
      compactLines.push(prefix + line);
    }
  }

  return compactLines.join('\n');
}

/**
 * Automatically selects compact or full diff based on size.
 * 
 * @param oldText - Original file content
 * @param newText - Modified file content
 * @returns Compact diff if full diff exceeds threshold, otherwise full diff
 */
export function generateSmartDiff(oldText: string, newText: string): string {
  const fullDiff = generateUnifiedDiff(oldText, newText);
  
  if (fullDiff.length > COMPACT_DIFF_THRESHOLD) {
    return generateCompactDiff(oldText, newText);
  }
  
  return fullDiff;
}

export function lcs(lines1: string[], lines2: string[]): string[] {
  const m = lines1.length;
  const n = lines2.length;
  
  if (m === 0 || n === 0) return [];
  if (m > DIFF_MAX_FILE_LINES || n > DIFF_MAX_FILE_LINES) return [];

  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (lines1[i - 1] === lines2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const result: string[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (lines1[i - 1] === lines2[j - 1]) {
      result.unshift(lines1[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return result;
}
