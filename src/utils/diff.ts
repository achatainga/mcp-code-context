/**
 * Diff Engine - v3.5.0
 * LCS-based unified diff with memory safety cap
 */

const MAX_DIFF_LINES = 5000;

interface DiffLine {
  type: 'context' | 'add' | 'remove';
  content: string;
  lineNumber?: number;
}

/**
 * Longest Common Subsequence algorithm
 */
function lcs(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp;
}

/**
 * Generate unified diff using LCS algorithm
 * Falls back to simple diff for large files to prevent OOM
 */
export function generateUnifiedDiff(
  oldContent: string,
  newContent: string,
  contextLines: number = 3
): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  // SAFETY: Fall back to simple diff for large files (LCS is O(n*m) memory)
  if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) {
    return generateSimpleDiff(oldContent, newContent);
  }

  const dp = lcs(oldLines, newLines);
  const diff: DiffLine[] = [];

  // Backtrack to find differences
  let i = oldLines.length;
  let j = newLines.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diff.unshift({ type: 'context', content: oldLines[i - 1], lineNumber: i });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diff.unshift({ type: 'add', content: newLines[j - 1], lineNumber: j });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      diff.unshift({ type: 'remove', content: oldLines[i - 1], lineNumber: i });
      i--;
    }
  }

  // Format output with context
  const output: string[] = [];
  let inHunk = false;
  let contextCount = 0;

  for (let idx = 0; idx < diff.length; idx++) {
    const line = diff[idx];

    if (line.type === 'context') {
      if (inHunk) {
        contextCount++;
        if (contextCount <= contextLines) {
          output.push(`  ${line.content}`);
        } else {
          inHunk = false;
          contextCount = 0;
        }
      } else {
        // Check if change is coming
        const hasChangeAhead = diff.slice(idx, idx + contextLines + 1)
          .some(l => l.type !== 'context');
        if (hasChangeAhead) {
          output.push(`  ${line.content}`);
        }
      }
    } else {
      if (!inHunk) {
        // Add context before change
        const contextBefore = diff.slice(Math.max(0, idx - contextLines), idx)
          .filter(l => l.type === 'context');
        contextBefore.forEach(l => output.push(`  ${l.content}`));
      }

      inHunk = true;
      contextCount = 0;

      if (line.type === 'add') {
        output.push(`+ ${line.content}`);
      } else {
        output.push(`- ${line.content}`);
      }
    }
  }

  return output.join('\n');
}

/**
 * Simple line-by-line diff (O(n) memory fallback for large files)
 */
export function generateSimpleDiff(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  const diff: string[] = [];
  const maxLen = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine === newLine) {
      diff.push(`  ${oldLine || ''}`);
    } else {
      if (oldLine !== undefined) diff.push(`- ${oldLine}`);
      if (newLine !== undefined) diff.push(`+ ${newLine}`);
    }
  }

  return diff.join('\n');
}
