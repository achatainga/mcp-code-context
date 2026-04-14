/**
 * SemanticCompressor — The AST engine that extracts structural signatures
 * from source files, stripping implementation bodies to save tokens.
 *
 * Supports:
 * - TypeScript / JavaScript (via ts-morph AST)
 * - PHP (via php-parser AST — Glayzzle)
 * - Dart (via regex + brace-counting)
 * - Python (via regex-based extraction)
 * - Generic files (passthrough for small configs, summary for large files)
 */

import {
  Project,
  SyntaxKind,
  ts,
  type SourceFile,
  type FunctionDeclaration,
  type ClassDeclaration,
  type MethodDeclaration,
  type ArrowFunction,
  type FunctionExpression,
} from "ts-morph";
import * as path from "node:path";
import { compressPHP, extractPHPSymbol } from "./phpCompressor.js";
import { compressDart, extractDartSymbol } from "./dartCompressor.js";

// ─── Supported extensions ───────────────────────────────────────────

const TS_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs",
]);

const PY_EXTENSIONS = new Set([".py", ".pyi"]);

const PHP_EXTENSIONS = new Set([".php", ".phtml"]);

const DART_EXTENSIONS = new Set([".dart"]);

const CONFIG_EXTENSIONS = new Set([
  ".json", ".yaml", ".yml", ".toml", ".ini", ".env",
  ".xml", ".html", ".css", ".scss", ".less",
  ".md", ".txt", ".svg",
]);

// ─── Singleton ts-morph Project (reusable, in-memory) ───────────────

let _project: Project | null = null;

function getProject(): Project {
  if (!_project) {
    _project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        allowJs: true,
        strict: false,
        noEmit: true,
        skipLibCheck: true,
      },
    });
  }
  return _project;
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Compress a source file into its semantic skeleton.
 * Returns only structural signatures — no function bodies.
 */
export function compressFile(filePath: string, content: string): string {
  const ext = path.extname(filePath).toLowerCase();

  if (TS_EXTENSIONS.has(ext)) {
    return compressTypeScript(content, filePath);
  }

  if (PHP_EXTENSIONS.has(ext)) {
    return compressPHP(content);
  }

  if (DART_EXTENSIONS.has(ext)) {
    return compressDart(content);
  }

  if (PY_EXTENSIONS.has(ext)) {
    return compressPython(content);
  }

  return compressGeneric(content, filePath);
}

/**
 * Extract the full source code of a named symbol from a file.
 * Returns null if the symbol is not found.
 */
export function extractSymbol(
  content: string,
  symbolName: string,
  filePath: string,
): string | null {
  const ext = path.extname(filePath).toLowerCase();

  if (TS_EXTENSIONS.has(ext)) {
    return extractTSSymbol(content, symbolName, filePath);
  }

  if (PHP_EXTENSIONS.has(ext)) {
    return extractPHPSymbol(content, symbolName);
  }

  if (DART_EXTENSIONS.has(ext)) {
    return extractDartSymbol(content, symbolName);
  }

  if (PY_EXTENSIONS.has(ext)) {
    return extractPySymbol(content, symbolName);
  }

  return null;
}

// ─── TypeScript / JavaScript Compression ────────────────────────────

function compressTypeScript(content: string, filePath: string): string {
  const project = getProject();
  const ext = path.extname(filePath);
  const tempName = `temp_${Date.now()}${ext}`;

  let sourceFile: SourceFile;
  try {
    sourceFile = project.createSourceFile(tempName, content, {
      overwrite: true,
    });
  } catch {
    return compressGeneric(content, filePath);
  }

  try {
    const chunks: string[] = [];

    // 1) Imports — keep for dependency context
    const imports = sourceFile.getImportDeclarations();
    if (imports.length > 0) {
      chunks.push("// ── Imports ──");
      for (const imp of imports) {
        chunks.push(imp.getText());
      }
      chunks.push("");
    }

    // 2) Type aliases
    for (const ta of sourceFile.getTypeAliases()) {
      chunks.push(ta.getText());
    }

    // 3) Interfaces (already just signatures)
    for (const iface of sourceFile.getInterfaces()) {
      chunks.push(iface.getText());
    }

    // 4) Enums
    for (const enumDecl of sourceFile.getEnums()) {
      chunks.push(enumDecl.getText());
    }

    // 5) Function declarations (signature only, body stripped)
    for (const func of sourceFile.getFunctions()) {
      chunks.push(buildFunctionSignature(func));
    }

    // 6) Class declarations (signatures only)
    for (const cls of sourceFile.getClasses()) {
      chunks.push(buildClassSignature(cls));
    }

    // 7) Exported variable statements (arrow fns, consts, etc.)
    for (const varStmt of sourceFile.getVariableStatements()) {
      if (!varStmt.isExported()) continue;

      for (const decl of varStmt.getDeclarations()) {
        const init = decl.getInitializer();
        if (!init) continue;

        const kind = init.getKind();
        if (
          kind === SyntaxKind.ArrowFunction ||
          kind === SyntaxKind.FunctionExpression
        ) {
          const fn = init as ArrowFunction | FunctionExpression;
          const params = fn
            .getParameters()
            .map((p) => p.getText())
            .join(", ");
          const retNode = fn.getReturnTypeNode();
          const retType = retNode ? `: ${retNode.getText()}` : "";
          const asyncMod = fn.isAsync() ? "async " : "";
          const declKind = varStmt.getDeclarationKind();
          chunks.push(
            `export ${declKind} ${asyncMod}${decl.getName()} = (${params})${retType} => { /* ... */ };`,
          );
        } else {
          const declKind = varStmt.getDeclarationKind();
          const typeNode = decl.getTypeNode();
          const typeStr = typeNode ? `: ${typeNode.getText()}` : "";
          chunks.push(
            `export ${declKind} ${decl.getName()}${typeStr};`,
          );
        }
      }
    }

    // 8) Re-export declarations
    for (const exp of sourceFile.getExportDeclarations()) {
      chunks.push(exp.getText());
    }

    // 9) Export assignments (export default ...)
    const exportAssignment = sourceFile.getExportAssignment(
      (ea) => !ea.isExportEquals(),
    );
    if (exportAssignment) {
      chunks.push(exportAssignment.getText());
    }

    return chunks.filter((c) => c.trim()).join("\n\n");
  } finally {
    // Clean up the in-memory source file to avoid memory leaks
    try {
      project.removeSourceFile(sourceFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}

function buildFunctionSignature(func: FunctionDeclaration): string {
  const name = func.getName() || "anonymous";
  const params = func
    .getParameters()
    .map((p) => p.getText())
    .join(", ");
  const retNode = func.getReturnTypeNode();
  const retType = retNode ? `: ${retNode.getText()}` : "";
  const exported = func.isExported() ? "export " : "";
  const isDefault = func.isDefaultExport() ? "default " : "";
  const asyncMod = func.isAsync() ? "async " : "";
  const generics = func
    .getTypeParameters()
    .map((tp) => tp.getText())
    .join(", ");
  const genericStr = generics ? `<${generics}>` : "";
  const overloads = func.getOverloads();

  const parts: string[] = [];
  for (const overload of overloads) {
    parts.push(overload.getText());
  }
  parts.push(
    `${exported}${isDefault}${asyncMod}function ${name}${genericStr}(${params})${retType} { /* ... */ }`,
  );
  return parts.join("\n");
}

function buildClassSignature(cls: ClassDeclaration): string {
  const lines: string[] = [];
  const name = cls.getName() || "AnonymousClass";
  const exported = cls.isExported() ? "export " : "";
  const isDefault = cls.isDefaultExport() ? "default " : "";
  const isAbstract = cls.isAbstract() ? "abstract " : "";
  const extendsExpr = cls.getExtends();
  const implementsClauses = cls.getImplements();
  const generics = cls
    .getTypeParameters()
    .map((tp) => tp.getText())
    .join(", ");
  const genericStr = generics ? `<${generics}>` : "";

  let header = `${exported}${isDefault}${isAbstract}class ${name}${genericStr}`;
  if (extendsExpr) header += ` extends ${extendsExpr.getText()}`;
  if (implementsClauses.length > 0) {
    header += ` implements ${implementsClauses.map((i) => i.getText()).join(", ")}`;
  }
  header += " {";
  lines.push(header);

  // Constructor
  for (const ctor of cls.getConstructors()) {
    const params = ctor
      .getParameters()
      .map((p) => p.getText())
      .join(", ");
    lines.push(`  constructor(${params}) { /* ... */ }`);
  }

  // Properties
  for (const prop of cls.getProperties()) {
    const mods = prop
      .getModifiers()
      .map((m) => m.getText())
      .join(" ");
    const modStr = mods ? `${mods} ` : "";
    const typeNode = prop.getTypeNode();
    const typeStr = typeNode ? `: ${typeNode.getText()}` : "";
    const optional = prop.hasQuestionToken() ? "?" : "";
    const isReadonly = prop.isReadonly() ? "readonly " : "";
    lines.push(
      `  ${modStr}${isReadonly}${prop.getName()}${optional}${typeStr};`,
    );
  }

  // Methods (signature only)
  for (const method of cls.getMethods()) {
    lines.push(`  ${buildMethodSignature(method)}`);
  }

  // Getters
  for (const getter of cls.getGetAccessors()) {
    const retNode = getter.getReturnTypeNode();
    const retType = retNode ? `: ${retNode.getText()}` : "";
    lines.push(`  get ${getter.getName()}()${retType} { /* ... */ }`);
  }

  // Setters
  for (const setter of cls.getSetAccessors()) {
    const params = setter
      .getParameters()
      .map((p) => p.getText())
      .join(", ");
    lines.push(`  set ${setter.getName()}(${params}) { /* ... */ }`);
  }

  lines.push("}");
  return lines.join("\n");
}

function buildMethodSignature(method: MethodDeclaration): string {
  const mods = method
    .getModifiers()
    .map((m) => m.getText())
    .join(" ");
  const modStr = mods ? `${mods} ` : "";
  const asyncMod = method.isAsync() ? "async " : "";
  const name = method.getName();
  const params = method
    .getParameters()
    .map((p) => p.getText())
    .join(", ");
  const retNode = method.getReturnTypeNode();
  const retType = retNode ? `: ${retNode.getText()}` : "";
  const generics = method
    .getTypeParameters()
    .map((tp) => tp.getText())
    .join(", ");
  const genericStr = generics ? `<${generics}>` : "";

  return `${modStr}${asyncMod}${name}${genericStr}(${params})${retType} { /* ... */ }`;
}

// ─── Python Compression ─────────────────────────────────────────────

function compressPython(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let i = 0;

  // Phase 1: Collect imports at the top
  const importBlock: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("import ") || t.startsWith("from ")) {
      importBlock.push(line);
    }
  }
  if (importBlock.length > 0) {
    result.push("# ── Imports ──");
    result.push(...importBlock);
    result.push("");
  }

  // Phase 2: Walk the file extracting signatures
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    const indent = measureIndent(line);

    // Skip import lines (already captured)
    if (trimmed.startsWith("import ") || trimmed.startsWith("from ")) {
      i++;
      continue;
    }

    // Decorators — pass through
    if (trimmed.startsWith("@")) {
      result.push(line);
      i++;
      continue;
    }

    // Class definition
    if (/^class\s+\w+/.test(trimmed)) {
      // Capture the full class signature (may span multiple lines)
      let signature = line;
      i++;
      while (i < lines.length && !signature.trimEnd().endsWith(":")) {
        signature += "\n" + lines[i];
        i++;
      }
      result.push(signature);

      // Capture docstring
      i = captureDocstring(lines, i, result);

      // Now extract methods within this class
      while (i < lines.length) {
        const innerLine = lines[i];
        const innerTrimmed = innerLine.trim();

        // Empty line within class is OK
        if (innerTrimmed === "") {
          i++;
          continue;
        }

        // Exited the class (non-indented non-empty line)
        if (measureIndent(innerLine) <= indent && innerTrimmed !== "") {
          break;
        }

        // Decorator before method
        if (innerTrimmed.startsWith("@")) {
          result.push(innerLine);
          i++;
          continue;
        }

        // Method definition
        if (/^\s*(async\s+)?def\s+\w+/.test(innerLine)) {
          let methodSig = innerLine;
          i++;
          while (i < lines.length && !methodSig.trimEnd().endsWith(":")) {
            methodSig += "\n" + lines[i];
            i++;
          }
          result.push(methodSig);

          // Capture method docstring
          i = captureDocstring(lines, i, result);

          // Placeholder for body
          const methodIndent = measureIndent(innerLine);
          result.push(" ".repeat(methodIndent + 4) + "...");
          result.push("");

          // Skip method body
          while (i < lines.length) {
            const bodyLine = lines[i];
            if (bodyLine.trim() === "") {
              i++;
              continue;
            }
            if (measureIndent(bodyLine) > methodIndent) {
              i++;
            } else {
              break;
            }
          }
          continue;
        }

        // Class-level attribute with type hint
        if (/^\s+\w+\s*:/.test(innerLine) && !innerTrimmed.startsWith("#")) {
          result.push(innerLine);
        }

        i++;
      }
      result.push("");
      continue;
    }

    // Top-level function definition
    if (/^(async\s+)?def\s+\w+/.test(trimmed)) {
      let signature = line;
      i++;
      while (i < lines.length && !signature.trimEnd().endsWith(":")) {
        signature += "\n" + lines[i];
        i++;
      }
      result.push(signature);

      // Capture docstring
      i = captureDocstring(lines, i, result);

      // Placeholder
      result.push("    ...");
      result.push("");

      // Skip body
      while (i < lines.length) {
        const bodyLine = lines[i];
        if (bodyLine.trim() === "") {
          i++;
          continue;
        }
        if (bodyLine.startsWith(" ") || bodyLine.startsWith("\t")) {
          i++;
        } else {
          break;
        }
      }
      continue;
    }

    // Top-level typed variable
    if (indent === 0 && /^\w+\s*:/.test(trimmed) && !trimmed.startsWith("#")) {
      result.push(line);
      i++;
      continue;
    }

    // Top-level assignment of special objects
    if (
      indent === 0 &&
      /^\w+\s*=/.test(trimmed) &&
      !trimmed.startsWith("#")
    ) {
      // Keep only single-line assignments to constants, named tuples, etc.
      if (!trimmed.includes("(") || trimmed.endsWith(")")) {
        result.push(line);
      }
      i++;
      continue;
    }

    i++;
  }

  return result.join("\n");
}

function captureDocstring(
  lines: string[],
  i: number,
  result: string[],
): number {
  if (i >= lines.length) return i;

  const trimmed = lines[i].trim();
  if (!trimmed.startsWith('"""') && !trimmed.startsWith("'''")) {
    return i;
  }

  const quoteType = trimmed.substring(0, 3);
  result.push(lines[i]);

  // Single-line docstring: """Something."""
  if (trimmed.length > 6 && trimmed.endsWith(quoteType)) {
    return i + 1;
  }

  // Multi-line docstring
  i++;
  while (i < lines.length) {
    result.push(lines[i]);
    if (lines[i].trim().endsWith(quoteType)) {
      return i + 1;
    }
    i++;
  }
  return i;
}

function measureIndent(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? match[1].length : 0;
}

// ─── Generic Compression ────────────────────────────────────────────

function compressGeneric(content: string, filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const lines = content.split("\n");
  const lineCount = lines.length;

  // Small config/data files: return as-is
  if (CONFIG_EXTENSIONS.has(ext) && lineCount <= 150) {
    return content;
  }

  // Larger files: provide a summary + head
  if (lineCount > 150) {
    const head = lines.slice(0, 60).join("\n");
    return [
      `// File: ${path.basename(filePath)} (${lineCount} lines)`,
      `// Language not supported for semantic compression.`,
      `// Showing first 60 lines:`,
      ``,
      head,
      ``,
      `// ... (${lineCount - 60} more lines truncated)`,
    ].join("\n");
  }

  return content;
}

// ─── Symbol Extraction (Full Source) ────────────────────────────────

function extractTSSymbol(
  content: string,
  symbolName: string,
  filePath: string,
): string | null {
  const project = getProject();
  const ext = path.extname(filePath);
  const tempName = `extract_${Date.now()}${ext}`;

  let sourceFile: SourceFile;
  try {
    sourceFile = project.createSourceFile(tempName, content, {
      overwrite: true,
    });
  } catch {
    return null;
  }

  try {
    // Search top-level functions
    const func = sourceFile.getFunction(symbolName);
    if (func) return func.getFullText().trim();

    // Search classes
    const cls = sourceFile.getClass(symbolName);
    if (cls) return cls.getFullText().trim();

    // Search interfaces
    const iface = sourceFile.getInterface(symbolName);
    if (iface) return iface.getFullText().trim();

    // Search type aliases
    const typeAlias = sourceFile.getTypeAlias(symbolName);
    if (typeAlias) return typeAlias.getFullText().trim();

    // Search enums
    const enumDecl = sourceFile.getEnum(symbolName);
    if (enumDecl) return enumDecl.getFullText().trim();

    // Search methods inside classes
    for (const c of sourceFile.getClasses()) {
      const method = c.getMethod(symbolName);
      if (method) return method.getFullText().trim();

      const getter = c.getGetAccessor(symbolName);
      if (getter) return getter.getFullText().trim();

      const setter = c.getSetAccessor(symbolName);
      if (setter) return setter.getFullText().trim();
    }

    // Search variable declarations (arrow functions, consts)
    for (const varStmt of sourceFile.getVariableStatements()) {
      for (const decl of varStmt.getDeclarations()) {
        if (decl.getName() === symbolName) {
          return varStmt.getFullText().trim();
        }
      }
    }

    return null;
  } finally {
    try {
      project.removeSourceFile(sourceFile);
    } catch {
      // Ignore
    }
  }
}

function extractPySymbol(
  content: string,
  symbolName: string,
): string | null {
  const lines = content.split("\n");
  const escapedName = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Match class or function by exact name
    const isClass = new RegExp(`^class\\s+${escapedName}[\\s(:]`).test(
      trimmed,
    );
    const isFunc = new RegExp(
      `^(?:async\\s+)?def\\s+${escapedName}\\s*\\(`,
    ).test(trimmed);

    if (!isClass && !isFunc) continue;

    const startLine = i;
    const baseIndent = measureIndent(line);
    const blockLines: string[] = [line];
    i++;

    // Capture the entire block (including body)
    while (i < lines.length) {
      const bodyLine = lines[i];
      if (bodyLine.trim() === "") {
        blockLines.push(bodyLine);
        i++;
        continue;
      }
      if (measureIndent(bodyLine) > baseIndent) {
        blockLines.push(bodyLine);
        i++;
      } else {
        break;
      }
    }

    // Trim trailing empty lines
    while (
      blockLines.length > 0 &&
      blockLines[blockLines.length - 1].trim() === ""
    ) {
      blockLines.pop();
    }

    return blockLines.join("\n");
  }

  return null;
}
