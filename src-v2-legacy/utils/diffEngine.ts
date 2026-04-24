/**
 * diffEngine.ts — Unified Diff Generator
 *
 * Generates human-readable unified diffs (like `git diff`) for dry-run reports
 * and post-write summaries. Uses a simple Myers-style diff algorithm.
 * No external dependencies.
 */

// ─── Types ──────────────────────────────────────────────────────────

interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Generate a unified diff between two versions of a single file.
 * Returns a string formatted like `git diff --unified=3`.
 */
export function generateDiff(
  oldContent: string,
  newContent: string,
  filePath: string,
  contextLines = 3,
): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  const hunks = computeHunks(oldLines, newLines, contextLines);

  if (hunks.length === 0) {
    return `--- ${filePath}\n+++ ${filePath}\n(no changes)\n`;
  }

  const header = [
    `--- a/${normalizedPath(filePath)}`,
    `+++ b/${normalizedPath(filePath)}`,
  ];

  const hunkTexts = hunks.map((hunk) => {
    const hunkHeader = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;
    return [hunkHeader, ...hunk.lines].join("\n");
  });

  return [...header, ...hunkTexts].join("\n") + "\n";
}

/**
 * Generate a combined diff across multiple files.
 * Returns a single string with all file diffs separated by blank lines.
 */
export function generateMultiFileDiff(
  changes: Array<{
    filePath: string;
    oldContent: string;
    newContent: string;
  }>,
): string {
  const diffs: string[] = [];

  for (const change of changes) {
    const diff = generateDiff(
      change.oldContent,
      change.newContent,
      change.filePath,
    );
    diffs.push(diff);
  }

  return diffs.join("\n");
}

// ─── Diff Algorithm ─────────────────────────────────────────────────

/**
 * Compute the Longest Common Subsequence table for two arrays of strings.
 */
function computeLCS(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;

  // Use a 2D array for the LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );

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
 * Backtrack through the LCS table to produce a list of diff operations.
 */
function backtrackDiff(
  dp: number[][],
  a: string[],
  b: string[],
): Array<{ type: "keep" | "remove" | "add"; line: string }> {
  const result: Array<{ type: "keep" | "remove" | "add"; line: string }> = [];
  let i = a.length;
  let j = b.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.unshift({ type: "keep", line: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: "add", line: b[j - 1] });
      j--;
    } else if (i > 0) {
      result.unshift({ type: "remove", line: a[i - 1] });
      i--;
    }
  }

  return result;
}

/**
 * Group diff operations into hunks with surrounding context.
 */
function computeHunks(
  oldLines: string[],
  newLines: string[],
  contextLines: number,
): DiffHunk[] {
  const dp = computeLCS(oldLines, newLines);
  const ops = backtrackDiff(dp, oldLines, newLines);

  // Find ranges of changes (non-"keep" operations)
  const changeIndices: number[] = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].type !== "keep") {
      changeIndices.push(i);
    }
  }

  if (changeIndices.length === 0) return [];

  // Group nearby changes into hunks
  const groups: Array<{ start: number; end: number }> = [];
  let groupStart = changeIndices[0];
  let groupEnd = changeIndices[0];

  for (let k = 1; k < changeIndices.length; k++) {
    if (changeIndices[k] - groupEnd <= contextLines * 2 + 1) {
      // Merge into current group
      groupEnd = changeIndices[k];
    } else {
      groups.push({ start: groupStart, end: groupEnd });
      groupStart = changeIndices[k];
      groupEnd = changeIndices[k];
    }
  }
  groups.push({ start: groupStart, end: groupEnd });

  // Build hunks with context
  const hunks: DiffHunk[] = [];

  for (const group of groups) {
    const hunkStart = Math.max(0, group.start - contextLines);
    const hunkEnd = Math.min(ops.length - 1, group.end + contextLines);

    const lines: string[] = [];
    let oldLineNum = 0;
    let newLineNum = 0;

    // Count lines before hunk start to get correct line numbers
    for (let i = 0; i < hunkStart; i++) {
      if (ops[i].type === "keep" || ops[i].type === "remove") oldLineNum++;
      if (ops[i].type === "keep" || ops[i].type === "add") newLineNum++;
    }

    const oldStart = oldLineNum + 1;
    const newStart = newLineNum + 1;
    let oldCount = 0;
    let newCount = 0;

    for (let i = hunkStart; i <= hunkEnd; i++) {
      const op = ops[i];
      switch (op.type) {
        case "keep":
          lines.push(` ${op.line}`);
          oldCount++;
          newCount++;
          break;
        case "remove":
          lines.push(`-${op.line}`);
          oldCount++;
          break;
        case "add":
          lines.push(`+${op.line}`);
          newCount++;
          break;
      }
    }

    hunks.push({ oldStart, oldCount, newStart, newCount, lines });
  }

  return hunks;
}

// ─── Utilities ──────────────────────────────────────────────────────

function normalizedPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}
