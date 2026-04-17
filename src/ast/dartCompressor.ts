/**
 * dartCompressor — Regex + brace-counting Dart semantic compressor.
 *
 * Dart has no npm AST parser, so we use a high-fidelity regex engine combined
 * with precise brace-counting to extract structural signatures from Dart source.
 * This approach handles all real-world Flutter/Dart patterns including generics,
 * factory constructors, mixins, extensions, and enum members.
 *
 * Design principles:
 *   1. Brace-counting for block boundaries — never fails on nested blocks
 *   2. Regex for signature detection — generics-aware, handles multi-line
 *   3. Preserve doc comments (///) for semantic context
 *   4. Preserve annotations (@override, @visibleForTesting, etc.)
 *   5. Preserve field declarations (they ARE the structural contract)
 */

// ─── Constants ──────────────────────────────────────────────────────

/**
 * Regex patterns for Dart structural elements.
 * These MUST handle generics (e.g., `Map<String, List<int>>`) which
 * contain `>` characters that could confuse naive parsers.
 */

// Top-level and class declarations
const DECLARATION_REGEX =
  /^(\s*)((?:abstract\s+|sealed\s+|base\s+|final\s+|interface\s+)*)(class|mixin|extension(?:\s+type)?|enum)\s+(\w+)/;

// Function/method declarations — handles generics, async, arrow syntax
// Matches: `Type? name<T>(params) async => ...` or `Type? name<T>(params) { ... }`
const METHOD_REGEX =
  /^(\s*)((?:static\s+|abstract\s+|external\s+|@\w+\s+)*)([\w<>,?\s[\]]+?\s+)?(\w+)\s*(<[^>]*>)?\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)\s*(async\*?|sync\*?)?\s*(=>\s*.+;|\{)/;

// Constructor regex — `ClassName(`, `ClassName.named(`, `factory ClassName(`
const CONSTRUCTOR_REGEX =
  /^(\s*)(const\s+|factory\s+)?((\w+)(\.\w+)?)\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)\s*(:\s*[^{;]+)?\s*([{;]|=>)/;

// Field/property declaration
const FIELD_REGEX =
  /^(\s*)((?:static\s+|late\s+|final\s+|const\s+|covariant\s+)*)([\w<>,?\s[\].]+?\s+)(\w+)\s*(=\s*[^;]+)?;/;

// Getter/setter
const GETTER_REGEX =
  /^(\s*)((?:static\s+)?)([\w<>,?\s[\].]*?\s+)?get\s+(\w+)\b/;
const SETTER_REGEX =
  /^(\s*)((?:static\s+)?)set\s+(\w+)\s*\(([^)]*)\)\s*([{]|=>)/;

// Import / export / part statements
const IMPORT_REGEX = /^(import|export|part\s+of|part)\s+['"]([^'"]+)['"]/;

// Typedef
const TYPEDEF_REGEX = /^(\s*)typedef\s+(.+);/;

// Enum case (inside an enum body)
const ENUM_CASE_REGEX = /^(\s*)(\w+)(\([^)]*\))?\s*[,;]/;

// ─── Public API ────────────────────────────────────────────────────

/**
 * Compress a Dart file into its semantic skeleton.
 * Returns only structural signatures — no function/method bodies.
 */
export function compressDart(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let i = 0;

  // Phase 1: Collect imports
  const importBlock: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (IMPORT_REGEX.test(t)) {
      importBlock.push(line);
    }
  }
  if (importBlock.length > 0) {
    result.push("// ── Imports ──");
    result.push(...importBlock);
    result.push("");
  }

  // Phase 2: Walk the file extracting structural signatures
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip blank lines
    if (trimmed === "") {
      i++;
      continue;
    }

    // Skip already-collected imports
    if (IMPORT_REGEX.test(trimmed)) {
      i++;
      continue;
    }

    // Skip single-line comments (not doc comments)
    if (trimmed.startsWith("//") && !trimmed.startsWith("///")) {
      i++;
      continue;
    }

    // Preserve doc comments (///) — collect them
    if (trimmed.startsWith("///")) {
      const docLines = collectDocComments(lines, i);
      result.push(...docLines.lines);
      i = docLines.nextIndex;
      continue;
    }

    // Preserve annotations (@override, @visibleForTesting, etc.)
    if (trimmed.startsWith("@") && !trimmed.startsWith("@override")) {
      result.push(line);
      i++;
      continue;
    }
    // @override — attach to next item, don't emit standalone
    if (trimmed === "@override") {
      result.push(line);
      i++;
      continue;
    }

    // Typedefs — pass through
    const typedefMatch = TYPEDEF_REGEX.exec(trimmed);
    if (typedefMatch) {
      result.push(line);
      i++;
      continue;
    }

    // Top-level constants and variables
    if (isTopLevelField(lines, i)) {
      const field = processFieldDeclaration(lines, i);
      result.push(...field.lines);
      i = field.nextIndex;
      continue;
    }

    // Class / Mixin / Extension / Enum declarations
    const declMatch = DECLARATION_REGEX.exec(trimmed);
    if (declMatch) {
      const classResult = processClassDeclaration(lines, i);
      result.push(...classResult.lines);
      i = classResult.nextIndex;
      continue;
    }

    // Top-level functions
    if (isTopLevelFunction(trimmed)) {
      const funcResult = processTopLevelFunction(lines, i);
      result.push(...funcResult.lines);
      i = funcResult.nextIndex;
      continue;
    }

    i++;
  }

  return result.join("\n");
}

/**
 * Extract the full source code of a named symbol from a Dart file.
 * Supports classes, mixins, extensions, enums, functions, and methods.
 * When className is provided, scopes method search to within that class only.
 * Returns null if the symbol is not found.
 */
export function extractDartSymbol(
  content: string,
  symbolName: string,
  className?: string,
): string | null {
  const lines = content.split("\n");

  // If className is provided, scope the search to within that class
  if (className) {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const declMatch = DECLARATION_REGEX.exec(trimmed);
      if (declMatch && declMatch[4] === className) {
        // Found the class — determine body boundaries
        let braceLineIdx = i;
        while (braceLineIdx < lines.length && !lines[braceLineIdx].includes("{")) {
          braceLineIdx++;
        }
        const bodyEnd = findMatchingBrace(lines, braceLineIdx + 1, 1);

        // Search only within the class body for the method
        for (let j = braceLineIdx + 1; j < bodyEnd; j++) {
          const bodyTrimmed = lines[j].trim();
          const methodMatch = bodyTrimmed.match(
            new RegExp(`\\b${escapeRegex(symbolName)}\\s*[<(]`),
          );
          if (
            methodMatch &&
            !DECLARATION_REGEX.test(bodyTrimmed) &&
            !IMPORT_REGEX.test(bodyTrimmed) &&
            (bodyTrimmed.includes("(") || bodyTrimmed.includes("<"))
          ) {
            if (
              isMethodOrConstructor(bodyTrimmed) ||
              isTopLevelFunction(bodyTrimmed)
            ) {
              return extractFullBlock(lines, j);
            }
          }
        }
        return null; // Method not found within the specified class
      }
    }
    return null; // Class not found
  }

  // Original behavior when no className is provided
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Match class-level declarations (class, mixin, extension, enum)
    const declMatch = DECLARATION_REGEX.exec(trimmed);
    if (declMatch && declMatch[4] === symbolName) {
      return extractFullBlock(lines, i);
    }

    // Match top-level functions
    if (isTopLevelFunction(trimmed)) {
      const funcName = extractFunctionName(trimmed);
      if (funcName === symbolName) {
        return extractFullBlock(lines, i);
      }
    }

    // Match methods inside classes (search inside class bodies)
    // Look for `methodName(` pattern
    const methodMatch = trimmed.match(
      new RegExp(`\\b${escapeRegex(symbolName)}\\s*[<(]`),
    );
    if (
      methodMatch &&
      !DECLARATION_REGEX.test(trimmed) &&
      !IMPORT_REGEX.test(trimmed) &&
      (trimmed.includes("(") || trimmed.includes("<"))
    ) {
      // Verify this is actually a method/function definition
      if (
        isMethodOrConstructor(trimmed) ||
        isTopLevelFunction(trimmed)
      ) {
        return extractFullBlock(lines, i);
      }
    }
  }

  return null;
}

// ─── Class / Mixin / Extension / Enum Processing ───────────────────

interface ProcessResult {
  lines: string[];
  nextIndex: number;
}

function processClassDeclaration(
  lines: string[],
  startIndex: number,
): ProcessResult {
  const result: string[] = [];
  let i = startIndex;

  // Collect leading doc comments that precede this declaration
  // (they may already have been emitted, so check if we need to go backwards)

  // Collect the full declaration header (may span multiple lines)
  let header = "";
  while (i < lines.length) {
    header += (header ? " " : "") + lines[i].trim();
    if (header.includes("{")) {
      break;
    }
    i++;
  }

  // Emit the header up to (and including) the opening brace
  const bracePos = header.indexOf("{");
  if (bracePos >= 0) {
    result.push(header.substring(0, bracePos + 1));
  } else {
    result.push(header);
    return { lines: result, nextIndex: i + 1 };
  }

  // Determine if this is an enum (special handling for cases)
  const isEnum = /\benum\s+/.test(header);

  // Find the matching closing brace
  i++;
  let braceDepth = 1;
  const bodyStart = i;
  const bodyEnd = findMatchingBrace(lines, i, braceDepth);

  // Process the body
  const bodyLines = lines.slice(bodyStart, bodyEnd);
  let j = 0;

  while (j < bodyLines.length) {
    const bodyLine = bodyLines[j];
    const bodyTrimmed = bodyLine.trim();

    // Skip blank lines
    if (bodyTrimmed === "") {
      j++;
      continue;
    }

    // Doc comments — preserve
    if (bodyTrimmed.startsWith("///")) {
      const docs = collectDocCommentsRelative(bodyLines, j);
      result.push(...docs.lines);
      j = docs.nextIndex;
      continue;
    }

    // Annotations — preserve
    if (bodyTrimmed.startsWith("@")) {
      result.push(bodyLine.replace(/\r$/, ""));
      j++;
      continue;
    }

    // Enum cases (before the semicolon or methods)
    if (isEnum && isEnumCase(bodyTrimmed)) {
      result.push(bodyLine.replace(/\r$/, ""));
      j++;
      continue;
    }

    // Enum semicolon separator (between cases and methods/fields)
    if (isEnum && bodyTrimmed === ";") {
      result.push(bodyLine.replace(/\r$/, ""));
      j++;
      continue;
    }

    // Field declarations
    if (isFieldDeclaration(bodyLines, j)) {
      const field = processFieldDeclaration(bodyLines, j);
      result.push(...field.lines);
      j = field.nextIndex;
      continue;
    }

    // Getter
    if (GETTER_REGEX.test(bodyTrimmed)) {
      const getter = processGetterSetter(bodyLines, j);
      result.push(...getter.lines);
      j = getter.nextIndex;
      continue;
    }

    // Setter
    if (bodyTrimmed.includes(" set ") && bodyTrimmed.includes("(")) {
      const setter = processGetterSetter(bodyLines, j);
      result.push(...setter.lines);
      j = setter.nextIndex;
      continue;
    }

    // Constructor or method
    if (isMethodOrConstructor(bodyTrimmed)) {
      const method = processMethodSignature(bodyLines, j);
      result.push(...method.lines);
      j = method.nextIndex;
      continue;
    }

    j++;
  }

  result.push("}");
  result.push("");
  return { lines: result, nextIndex: bodyEnd + 1 };
}

// ─── Top-level Functions ───────────────────────────────────────────

function processTopLevelFunction(
  lines: string[],
  startIndex: number,
): ProcessResult {
  const result: string[] = [];
  let i = startIndex;

  // Collect the full signature
  let signature = "";
  while (i < lines.length) {
    signature += (signature ? " " : "") + lines[i].trim();
    // Stop when we find `{` or `=> ...;`
    if (findBlockBraceIndex(signature) >= 0 || (signature.includes("=>") && signature.endsWith(";"))) {
      break;
    }
    i++;
  }

  const indent = getIndent(lines[startIndex]);

  if (signature.includes("=>") && signature.endsWith(";")) {
    const arrowPos = signature.indexOf("=>");
    result.push(`${indent}${signature.substring(0, arrowPos).trim()} => /* ... */;`);
  } else if (findBlockBraceIndex(signature) >= 0) {
    const bracePos = findBlockBraceIndex(signature);
    result.push(`${indent}${signature.substring(0, bracePos).trim()} { /* ... */ }`);
    // Skip the body
    i = findMatchingBrace(lines, i + 1, 1);
  }

  result.push("");
  return { lines: result, nextIndex: i + 1 };
}

// ─── Method/Constructor Signature Processing ───────────────────────

function processMethodSignature(
  bodyLines: string[],
  startIndex: number,
): ProcessResult {
  const result: string[] = [];
  let j = startIndex;

  // Collect the full signature (may span multiple lines until { or ; or =>)
  let signature = "";
  let foundEnd = false;

  while (j < bodyLines.length) {
    const lineContent = bodyLines[j].trim();
    signature += (signature ? " " : "") + lineContent;

    // Check if we have the complete signature
    if (findBlockBraceIndex(signature) >= 0) {
      foundEnd = true;
      break;
    }
    if (signature.includes("=>")) {
      // Arrow body — find the semicolon
      if (signature.endsWith(";")) {
        foundEnd = true;
        break;
      }
      // Multi-line arrow — keep collecting until ;
      j++;
      while (j < bodyLines.length) {
        const arrowLine = bodyLines[j].trim();
        signature += " " + arrowLine;
        if (arrowLine.endsWith(";")) {
          break;
        }
        j++;
      }
      foundEnd = true;
      break;
    }
    if (lineContent.endsWith(";")) {
      // Abstract method or similar
      foundEnd = true;
      break;
    }
    j++;
  }

  const indent = getIndent(bodyLines[startIndex]);

  if (!foundEnd) {
    result.push(bodyLines[startIndex].replace(/\r$/, ""));
    return { lines: result, nextIndex: j + 1 };
  }

  if (signature.includes("=>")) {
    const arrowPos = signature.indexOf("=>");
    result.push(`${indent}${signature.substring(0, arrowPos).trim()} => /* ... */;`);
  } else if (findBlockBraceIndex(signature) >= 0) {
    const bracePos = findBlockBraceIndex(signature);
    const sigPart = signature.substring(0, bracePos).trim();

    result.push(`${indent}${sigPart} { /* ... */ }`);
    j = findMatchingBraceRelative(bodyLines, j + 1, 1);
  } else if (signature.endsWith(";")) {
    result.push(`${indent}${signature}`);
  }

  return { lines: result, nextIndex: j + 1 };
}

function processFieldDeclaration(
  bodyLines: string[],
  startIndex: number,
): ProcessResult {
  const result: string[] = [];
  let j = startIndex;
  let signature = "";
  while (j < bodyLines.length) {
    signature += (signature ? " " : "") + bodyLines[j].trim();
    if (signature.endsWith(";")) break;
    j++;
  }
  const indent = getIndent(bodyLines[startIndex]);
  result.push(`${indent}${signature}`);
  return { lines: result, nextIndex: j + 1 };
}

// ─── Getter/Setter Processing ──────────────────────────────────────

function processGetterSetter(
  bodyLines: string[],
  startIndex: number,
): ProcessResult {
  const result: string[] = [];
  let j = startIndex;

  let signature = "";
  while (j < bodyLines.length) {
    signature += (signature ? " " : "") + bodyLines[j].trim();

    if (signature.includes("=>")) {
      if (signature.endsWith(";")) break;
      j++;
      while (j < bodyLines.length) {
        signature += " " + bodyLines[j].trim();
        if (bodyLines[j].trim().endsWith(";")) break;
        j++;
      }
      break;
    }
    if (findBlockBraceIndex(signature) >= 0) break;
    if (signature.endsWith(";")) break;
    j++;
  }

  const indent = getIndent(bodyLines[startIndex]);

  if (signature.includes("=>")) {
    const arrowPos = signature.indexOf("=>");
    result.push(`${indent}${signature.substring(0, arrowPos).trim()} => /* ... */;`);
  } else if (findBlockBraceIndex(signature) >= 0) {
    const bracePos = findBlockBraceIndex(signature);
    result.push(`${indent}${signature.substring(0, bracePos).trim()} { /* ... */ }`);
    j = findMatchingBraceRelative(bodyLines, j + 1, 1);
  } else {
    result.push(`${indent}${signature}`);
  }

  return { lines: result, nextIndex: j + 1 };
}

// ─── Utility Functions ─────────────────────────────────────────────

function collectDocComments(
  lines: string[],
  startIndex: number,
): ProcessResult {
  const result: string[] = [];
  let i = startIndex;
  while (i < lines.length && lines[i].trim().startsWith("///")) {
    result.push(lines[i].replace(/\r$/, ""));
    i++;
  }
  return { lines: result, nextIndex: i };
}

function collectDocCommentsRelative(
  lines: string[],
  startIndex: number,
): ProcessResult {
  return collectDocComments(lines, startIndex);
}

function isTopLevelField(lines: string[], startIndex: number): boolean {
  const line = lines[startIndex];
  const trimmed = line.trim();
  // Must be at indentation 0
  if (line.length > 0 && (line[0] === " " || line[0] === "\t")) return false;
  
  let signature = "";
  let j = startIndex;
  while (j < lines.length) {
    const t = lines[j].trim();
    if (t.startsWith("//") || t.startsWith("@")) break;
    signature += (signature ? " " : "") + t;
    if (signature.includes("{") || signature.includes("=>") || signature.includes("(")) return false;
    if (signature.endsWith(";")) break;
    j++;
  }
  
  if (!signature.endsWith(";")) return false;

  // Must look like a field: starts with const, final, var, type + name
  if (
    /^(const|final|var)\s+/.test(signature)
  ) {
    return true;
  }
  // Typed top-level: `String name = ...;` or `Type name;`
  if (
    /^[A-Z]\w*[<?\s]/.test(signature)
  ) {
    return true;
  }
  return false;
}

function isTopLevelFunction(trimmed: string): boolean {
  // Top-level function: async? returnType? functionName<T>(params) {
  // Exclude class/mixin/etc declarations
  if (DECLARATION_REGEX.test(trimmed)) return false;
  if (IMPORT_REGEX.test(trimmed)) return false;
  if (trimmed.startsWith("//")) return false;
  if (trimmed.startsWith("@")) return false;

  // Must contain `(` for parameter list
  if (!trimmed.includes("(")) return false;

  // Must not start with common non-function keywords
  if (/^(return|if|for|while|switch|try|catch|throw|assert|yield)\b/.test(trimmed)) {
    return false;
  }

  // Check common patterns:
  // `void main() {`
  // `Future<void> loadSections({bool forceRefresh = false}) async {`
  // `static Widget buildSection(Map<String, dynamic> section) {`
  if (
    /^([\w<>,?\s[\].]+?\s+)?(\w+)\s*(<[^>]*>)?\s*\(/.test(trimmed) &&
    (trimmed.includes("{") || trimmed.includes("=>") || trimmed.endsWith(")") || trimmed.includes(") async") || trimmed.includes(") sync"))
  ) {
    return true;
  }

  return false;
}

function extractFunctionName(trimmed: string): string {
  // Extract function name before the `(`
  const match = trimmed.match(/(\w+)\s*[<(]/);
  if (match) {
    // Filter out keywords that aren't actual function names
    const name = match[1];
    const keywords = new Set([
      "if", "for", "while", "switch", "try", "catch", "return",
      "class", "mixin", "enum", "extension", "import", "export",
      "void", "int", "double", "String", "bool", "List", "Map",
      "Set", "Future", "Stream", "const", "final", "var",
      "static", "abstract", "factory", "async", "await",
    ]);
    if (!keywords.has(name)) return name;
  }
  return "";
}

function isMethodOrConstructor(trimmed: string): boolean {
  if (trimmed.startsWith("//")) return false;
  if (trimmed.startsWith("@")) return false;
  if (!trimmed.includes("(")) return false;

  // Skip non-method statements
  if (/^(return|if|for|while|switch|try|catch|throw|assert|yield|super|this)\b/.test(trimmed)) {
    return false;
  }
  // Skip field declarations
  if (
    !trimmed.includes("(") ||
    (trimmed.endsWith(";") && !trimmed.includes(")") && !trimmed.includes("=>"))
  ) {
    return false;
  }

  // Factory constructors
  if (/^(const\s+|factory\s+)/.test(trimmed)) return true;

  // Regular methods/constructors: `Type? name(` or `name(`
  if (/^([\w<>,?\s[\].]*?\s*)?(\w+)(\.\w+)?\s*[<(]/.test(trimmed)) {
    return true;
  }

  return false;
}

function isFieldDeclaration(lines: string[], startIndex: number): boolean {
  const firstTrimmed = lines[startIndex].trim();
  if (firstTrimmed.startsWith("//")) return false;
  if (firstTrimmed.startsWith("@")) return false;

  let signature = "";
  let j = startIndex;
  while (j < lines.length) {
    const t = lines[j].trim();
    if (t.startsWith("//") || t.startsWith("@")) break;
    signature += (signature ? " " : "") + t;
    // Check for block braces OUTSIDE string literals
    // This prevents `'${...}'` Dart interpolation from being misidentified as block openers
    if (containsBlockBraceOutsideStrings(signature) || containsArrowOutsideStrings(signature)) {
      return false;
    }
    if (signature.endsWith(";")) break;
    j++;
  }

  // Field must end with a semicolon
  if (!signature.endsWith(";")) {
    return false;
  }

  // Contains `(` before `=` — probably a method or constructor, not a field
  // Exception: default values with constructors like `= SomeClass()`
  const parenIdx = signature.indexOf("(");
  const equalsIdx = signature.indexOf("=");
  if (parenIdx >= 0 && (equalsIdx < 0 || parenIdx < equalsIdx)) {
    return false;
  }

  // Looks like: modifiers type name [= value];
  return /^(static\s+|late\s+|final\s+|const\s+|covariant\s+)*([\w<>,?\s[\].]*?\s+)(\w+)/.test(signature);
}

function isEnumCase(trimmed: string): boolean {
  // Enum case: `caseName,` or `caseName;` or `caseName(args),`
  if (trimmed.startsWith("//") || trimmed.startsWith("@")) return false;

  // Must not look like a method or field with a type
  if (/^(static|final|const|late|void|int|double|String|bool|Future|Stream|List|Map|Set|var)\b/.test(trimmed)) {
    return false;
  }

  // Enum case pattern: identifier optionally followed by (args), then , or ;
  if (/^\w+(\([^)]*\))?\s*[,;]?\s*$/.test(trimmed)) {
    return true;
  }

  return false;
}

function findMatchingBrace(
  lines: string[],
  startIndex: number,
  initialDepth: number,
): number {
  let depth = initialDepth;
  let i = startIndex;

  while (i < lines.length && depth > 0) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return i;
      }
    }
    i++;
  }

  return i;
}

function findMatchingBraceRelative(
  lines: string[],
  startIndex: number,
  initialDepth: number,
): number {
  return findMatchingBrace(lines, startIndex, initialDepth);
}

function extractFullBlock(
  lines: string[],
  startIndex: number,
): string {
  // Walk backwards to capture doc comments and annotations
  let actualStart = startIndex;
  for (let k = startIndex - 1; k >= 0; k--) {
    const t = lines[k].trim();
    if (
      t.startsWith("///") ||
      t.startsWith("@") ||
      t === ""
    ) {
      if (t !== "") actualStart = k;
    } else {
      break;
    }
  }

  // Determine block end
  const line = lines[startIndex].trim();

  // Check if this is a single-line declaration (no body)
  if (line.endsWith(";") && !line.includes("{")) {
    const block = lines.slice(actualStart, startIndex + 1);
    while (block.length > 0 && block[block.length - 1].trim() === "") {
      block.pop();
    }
    return block.map((l) => l.replace(/\r$/, "")).join("\n");
  }

  // Find the matching closing brace using a combined approach
  // We skip all braces until we find the real '{' that opens the block, 
  // which is the first '{' encountered when parens are balanced.
  let parenDepth = 0;
  let blockDepth = 0;
  let startedCounting = false;
  let endIdx = startIndex;

  for (let k = startIndex; k < lines.length; k++) {
    const lineStr = lines[k];
    
    // Quick check for => arrow functions on the first few lines if we haven't started
    if (!startedCounting && lineStr.includes("=>")) {
      let arrowEndIdx = k;
      while (arrowEndIdx < lines.length && !lines[arrowEndIdx].trim().endsWith(";")) {
        arrowEndIdx++;
      }
      const block = lines.slice(actualStart, arrowEndIdx + 1);
      return block.map((l) => l.replace(/\r$/, "")).join("\n");
    }

    for (const ch of lineStr) {
      if (!startedCounting) {
        if (ch === "(") parenDepth++;
        else if (ch === ")") parenDepth--;
        else if (ch === "{" && parenDepth === 0) {
          // Found the real opening brace!
          startedCounting = true;
          blockDepth = 1;
        }
      } else {
        // We are inside the body block
        if (ch === "{") {
          blockDepth++;
        } else if (ch === "}") {
          blockDepth--;
          if (blockDepth === 0) {
            endIdx = k;
            break;
          }
        }
      }
    }
    
    if (startedCounting && blockDepth === 0) {
      // Break the outer line loop as well
      break;
    }
  }

  // If we never started counting, it's probably an abstract method or just a field
  if (!startedCounting) {
    return lines.slice(actualStart, startIndex + 1).map((l) => l.replace(/\r$/, "")).join("\n");
  }

  const block = lines.slice(actualStart, endIdx + 1);
  while (block.length > 0 && block[block.length - 1].trim() === "") {
    block.pop();
  }
  return block.map((l) => l.replace(/\r$/, "")).join("\n");
}

function getIndent(line: string): string {
  const match = line.match(/^(\s*)/);
  return match ? match[1] : "";
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findBlockBraceIndex(signature: string): number {
  let parenDepth = 0;
  for (let i = 0; i < signature.length; i++) {
    const ch = signature[i];
    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth--;
    else if (ch === "{" && parenDepth === 0) {
      return i;
    }
  }
  return -1;
}

/**
 * Check if a signature contains `{` outside of string literals.
 * This is critical for Dart where string interpolation `'${expr}'`
 * contains braces that are NOT block openers.
 */
function containsBlockBraceOutsideStrings(signature: string): boolean {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let parenDepth = 0;

  for (let i = 0; i < signature.length; i++) {
    const ch = signature[i];

    // Handle escape sequences
    if ((inSingleQuote || inDoubleQuote) && ch === "\\" && i + 1 < signature.length) {
      i++; // skip escaped character
      continue;
    }

    // Toggle string state
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    // Skip characters inside strings
    if (inSingleQuote || inDoubleQuote) continue;

    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth--;
    else if (ch === "{" && parenDepth === 0) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a signature contains `=>` outside of string literals.
 */
function containsArrowOutsideStrings(signature: string): boolean {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < signature.length; i++) {
    const ch = signature[i];

    if ((inSingleQuote || inDoubleQuote) && ch === "\\" && i + 1 < signature.length) {
      i++;
      continue;
    }

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) continue;

    if (ch === "=" && i + 1 < signature.length && signature[i + 1] === ">") {
      return true;
    }
  }
  return false;
}
