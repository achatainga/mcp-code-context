export interface SymbolInfo {
  name: string;
  type: string;
  className?: string;
}

export function levenshteinDistance(a: string, b: string): number {
  const matrix = [];
  let i, j;

  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  for (i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (i = 1; i <= b.length; i++) {
    for (j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

export function findClosestSymbols(target: string, symbols: SymbolInfo[], limit = 5): SymbolInfo[] {
  return symbols
    .map((sym) => ({
      ...sym,
      distance: levenshteinDistance(target.toLowerCase(), sym.name.toLowerCase()),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

// A simple regex-based extractor to get available symbols when the AST parsing fails
export function extractFallbackSymbols(content: string): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];
  const lines = content.split('\\n');
  
  let currentClass: string | undefined = undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Check for class definitions (multi-language approx)
    const classMatch = line.match(/^\s*(?:export\s+|abstract\s+|final\s+)?class\s+([_a-zA-Z0-9]+)/);
    if (classMatch) {
      currentClass = classMatch[1];
      symbols.push({ name: currentClass, type: 'class' });
      continue;
    }

    // Check for function / method definitions
    // JS/TS: function foo() | foo() { | async foo()
    // Python: def foo()
    // PHP: function foo()
    // Dart: type foo()
    const funcMatch = line.match(/^\s*(?:export\s+|async\s+|public\s+|private\s+|protected\s+|static\s+|def\s+|function\s+)*([_a-zA-Z0-9]+)\s*\(/);
    if (funcMatch && !['if', 'else', 'for', 'while', 'switch', 'catch'].includes(funcMatch[1])) {
      symbols.push({
        name: funcMatch[1],
        type: currentClass ? 'method' : 'function',
        className: currentClass,
      });
    }

    // Basic assumption: closing brace at start of line might end a class
    if (line === '}') {
      currentClass = undefined;
    }
  }

  return symbols;
}
