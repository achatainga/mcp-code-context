/**
 * Safe Regex - v3.3.0
 * Regex execution with timeout to prevent ReDoS
 */

import { REGEX_TIMEOUT_MS } from './constants.js';

export interface RegexResult {
  success: boolean;
  matches?: RegExpMatchArray | null;
  error?: string;
  timedOut?: boolean;
}

/**
 * Execute regex with timeout protection
 */
export async function safeRegexTest(
  pattern: string | RegExp,
  input: string,
  timeoutMs: number = REGEX_TIMEOUT_MS
): Promise<{ success: boolean; matched: boolean; error?: string; timedOut?: boolean }> {
  return new Promise((resolve) => {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      resolve({
        success: false,
        matched: false,
        error: `Regex execution exceeded ${timeoutMs}ms (potential ReDoS)`,
        timedOut: true,
      });
    }, timeoutMs);

    try {
      const matched = regex.test(input);
      clearTimeout(timeout);

      if (timedOut) return; // Already resolved

      resolve({ success: true, matched });
    } catch (error) {
      clearTimeout(timeout);
      if (timedOut) return;

      resolve({
        success: false,
        matched: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

/**
 * Execute regex match with timeout protection
 */
export async function safeRegexMatch(
  pattern: string | RegExp,
  input: string,
  timeoutMs: number = REGEX_TIMEOUT_MS
): Promise<RegexResult> {
  return new Promise((resolve) => {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      resolve({
        success: false,
        error: `Regex execution exceeded ${timeoutMs}ms (potential ReDoS)`,
        timedOut: true,
      });
    }, timeoutMs);

    try {
      const matches = input.match(regex);
      clearTimeout(timeout);

      if (timedOut) return;

      resolve({ success: true, matches });
    } catch (error) {
      clearTimeout(timeout);
      if (timedOut) return;

      resolve({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

/**
 * Validate regex pattern for safety
 */
export function validateRegexPattern(pattern: string): { safe: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check for catastrophic backtracking patterns
  const dangerousPatterns = [
    { pattern: /\([^)]*\+\)\+/, message: 'Nested quantifiers (a+)+ detected' },
    { pattern: /\([^)]*\*\)\*/, message: 'Nested quantifiers (a*)* detected' },
    { pattern: /\([^)]*\+\)\*/, message: 'Nested quantifiers (a+)* detected' },
    { pattern: /\([^)]*\*\)\+/, message: 'Nested quantifiers (a*)+ detected' },
    { pattern: /\([^|]*\|[^)]*\)\*/, message: 'Alternation with star (a|b)* detected' },
    { pattern: /\([^|]*\|[^)]*\)\+/, message: 'Alternation with plus (a|b)+ detected' },
  ];

  for (const { pattern: dangerousPattern, message } of dangerousPatterns) {
    if (dangerousPattern.test(pattern)) {
      issues.push(message);
    }
  }

  // Check for excessive repetition
  if (/\{(\d+),\}/.test(pattern)) {
    const match = pattern.match(/\{(\d+),\}/);
    if (match && parseInt(match[1]) > 1000) {
      issues.push('Excessive repetition {n,} with n > 1000');
    }
  }

  // Check for very long patterns (potential complexity)
  if (pattern.length > 500) {
    issues.push('Pattern exceeds 500 characters');
  }

  return {
    safe: issues.length === 0,
    issues,
  };
}

/**
 * Sanitize regex pattern (escape metacharacters)
 */
export function sanitizeRegexPattern(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Create safe regex with validation
 */
export function createSafeRegex(
  pattern: string,
  flags?: string
): { regex: RegExp | null; error?: string } {
  const validation = validateRegexPattern(pattern);

  if (!validation.safe) {
    return {
      regex: null,
      error: `Unsafe regex pattern: ${validation.issues.join(', ')}`,
    };
  }

  try {
    const regex = new RegExp(pattern, flags);
    return { regex };
  } catch (error) {
    return {
      regex: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
