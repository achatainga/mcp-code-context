/**
 * Diff Utilities - v3.6.0
 * Uses diff-match-patch for efficient diffing
 */

import DiffMatchPatch from 'diff-match-patch';

const dmp = new DiffMatchPatch();

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  lineNumber?: number;
}

export function generateUnifiedDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  if (oldLines.length > 5000 || newLines.length > 5000) {
    return generateSimpleDiff(oldText, newText);
  }

  const diffs = dmp.diff_main(oldText, newText);
  dmp.diff_cleanupSemantic(diffs);

  const patch = dmp.patch_make(oldText, diffs);
  return dmp.patch_toText(patch);
}

export function generateSimpleDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  return `File too large for detailed diff.
Old: ${oldLines.length} lines
New: ${newLines.length} lines
Changed: ${Math.abs(oldLines.length - newLines.length)} lines`;
}

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

export function generateSmartDiff(oldText: string, newText: string): string {
  const fullDiff = generateUnifiedDiff(oldText, newText);
  
  if (fullDiff.length > 2048) {
    return generateCompactDiff(oldText, newText);
  }
  
  return fullDiff;
}

export function lcs(lines1: string[], lines2: string[]): string[] {
  const m = lines1.length;
  const n = lines2.length;
  
  if (m === 0 || n === 0) return [];
  if (m > 5000 || n > 5000) return [];

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
