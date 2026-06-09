/**
 * Regex pattern validation and sanitization (synchronous — no worker needed)
 */

export function validateRegexPattern(pattern: string): { safe: boolean; issues: string[] } {
  const issues: string[] = [];

  const dangerousPatterns = [
    { pattern: /\([^)]*\+\)\+/, message: "Nested quantifiers (a+)+ detected" },
    { pattern: /\([^)]*\*\)\*/, message: "Nested quantifiers (a*)* detected" },
    { pattern: /\([^)]*\+\)\*/, message: "Nested quantifiers (a+)* detected" },
    { pattern: /\([^)]*\*\)\+/, message: "Nested quantifiers (a*)+ detected" },
    { pattern: /\([^|]*\|[^)]*\)\*/, message: "Alternation with star (a|b)* detected" },
    { pattern: /\([^|]*\|[^)]*\)\+/, message: "Alternation with plus (a|b)+ detected" },
  ];

  for (const { pattern: dangerousPattern, message } of dangerousPatterns) {
    if (dangerousPattern.test(pattern)) {
      issues.push(message);
    }
  }

  if (/\{(\d+),\}/.test(pattern)) {
    const match = pattern.match(/\{(\d+),\}/);
    if (match && parseInt(match[1]) > 1000) {
      issues.push("Excessive repetition {n,} with n > 1000");
    }
  }

  if (pattern.length > 500) {
    issues.push("Pattern exceeds 500 characters");
  }

  return { safe: issues.length === 0, issues };
}

export function sanitizeRegexPattern(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createSafeRegex(
  pattern: string,
  flags?: string
): { regex: RegExp | null; error?: string } {
  const validation = validateRegexPattern(pattern);
  if (!validation.safe) {
    return { regex: null, error: `Unsafe regex pattern: ${validation.issues.join(", ")}` };
  }
  try {
    return { regex: new RegExp(pattern, flags) };
  } catch (error) {
    return {
      regex: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
