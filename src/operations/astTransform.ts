/**
 * AST Transform - v3.7.1
 * Declarative AST transformations using Tree-sitter.
 * Operates on symbol positions from the AST — no fragile text matching.
 */

import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { SecurityValidator } from "../core/validator.js";
import { BaseParser, SymbolInfo } from "../parsers/base.js";
import { validateSyntax, generateDiff } from "./write.js";
import type { WriteResult } from "./write.js";

export type TransformKind =
  | "add_parameter"
  | "wrap_with_try_catch"
  | "add_decorator"
  | "change_return_type"
  | "extract_variable";

export interface TransformParams {
  kind: TransformKind;
  /** For add_parameter: parameter text (e.g. "timeout: number = 5000") */
  parameter?: string;
  /** For add_parameter: position index (0-based, default: append) */
  parameterIndex?: number;
  /** For wrap_with_try_catch: catch body */
  catchBody?: string;
  /** For add_decorator: decorator text (e.g. "@deprecated") */
  decorator?: string;
  /** For change_return_type: new return type */
  returnType?: string;
  /** For extract_variable: expression to extract */
  expression?: string;
  /** For extract_variable: variable name */
  variableName?: string;
}

export interface AstTransformOptions {
  filePath: string;
  projectRoot: string;
  symbolName: string;
  className?: string;
  transform: TransformParams;
  parser: BaseParser;
}

/**
 * Apply a declarative AST transform to a symbol.
 * Returns a WriteResult compatible with the two-phase write flow.
 */
export async function astTransform(options: AstTransformOptions): Promise<WriteResult> {
  const { filePath, projectRoot, symbolName, className, transform, parser } = options;

  const validator = new SecurityValidator(projectRoot);
  const validation = await validator.validateFilePath(filePath);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    const content = await fs.readFile(validation.resolvedPath!, "utf-8");
    const originalHash = createHash("sha256").update(content).digest("hex");
    const tree = parser.parse(content);

    const symbols = parser.findSymbols(tree);
    const target = symbols.find(
      (s) => s.name === symbolName && (!className || s.className === className)
    );

    if (!target) {
      const available = symbols.map((s) => s.name).join(", ");
      return {
        success: false,
        error: `Symbol "${symbolName}" not found. Available: ${available}`,
      };
    }

    const symbolCode = content.substring(target.startIndex, target.endIndex);
    let transformed: string;

    switch (transform.kind) {
      case "add_parameter":
        transformed = applyAddParameter(symbolCode, transform);
        break;
      case "wrap_with_try_catch":
        transformed = applyWrapTryCatch(symbolCode, transform);
        break;
      case "add_decorator":
        transformed = applyAddDecorator(symbolCode, transform);
        break;
      case "change_return_type":
        transformed = applyChangeReturnType(symbolCode, transform);
        break;
      case "extract_variable":
        transformed = applyExtractVariable(symbolCode, transform);
        break;
      default:
        return { success: false, error: `Unknown transform kind: "${transform.kind}"` };
    }

    const result =
      content.substring(0, target.startIndex) +
      transformed +
      content.substring(target.endIndex);

    const syntaxCheck = validateSyntax(result, parser);
    if (!syntaxCheck.valid) {
      return { success: false, error: `Transform produced invalid syntax: ${syntaxCheck.error}` };
    }

    const diff = generateDiff(content, result);

    return { success: true, newContent: result, diff, originalHash };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ── Transform implementations ──────────────────────────────────────────

/**
 * Add a parameter to a function/method signature.
 * Locates the parameter list `(...)` and injects at the specified position.
 */
function applyAddParameter(code: string, params: TransformParams): string {
  if (!params.parameter) throw new Error("add_parameter requires 'parameter'");

  const openParen = code.indexOf("(");
  if (openParen === -1) throw new Error("No parameter list found in symbol");

  // Find matching close paren (handle nested parens)
  const closeParen = findMatchingParen(code, openParen);
  if (closeParen === -1) throw new Error("Unmatched parenthesis in symbol");

  const paramSection = code.substring(openParen + 1, closeParen).trim();
  const existingParams = paramSection ? splitParams(paramSection) : [];
  const index = params.parameterIndex ?? existingParams.length;
  existingParams.splice(index, 0, params.parameter);

  return (
    code.substring(0, openParen + 1) +
    existingParams.join(", ") +
    code.substring(closeParen)
  );
}

/**
 * Wrap the function/method body in try/catch.
 */
function applyWrapTryCatch(code: string, params: TransformParams): string {
  const catchBody = params.catchBody || "throw error;";

  const bodyStart = code.indexOf("{");
  if (bodyStart === -1) throw new Error("No function body found (arrow expression?)");

  const bodyEnd = findMatchingBrace(code, bodyStart);
  if (bodyEnd === -1) throw new Error("Unmatched brace in symbol");

  const rawBody = code.substring(bodyStart + 1, bodyEnd);
  const lines = rawBody.split("\n");

  // Last line is trailing whitespace before the closing } — preserve it as method closer
  const closingIndent = lines[lines.length - 1];
  const contentLines = lines.slice(0, -1);

  // Detect base indentation from first non-empty content line
  const nonEmpty = contentLines.filter((l) => l.trim() !== "");
  const baseIndent = nonEmpty.length > 0 ? (nonEmpty[0].match(/^(\s*)/)?.[1] ?? "  ") : "  ";

  // Shift each content line one level deeper (2 spaces) inside try {}
  const indentedContent = contentLines
    .map((l) => (l.trim() === "" ? l : "  " + l))
    .join("\n");

  const wrapped =
    `{\n${baseIndent}try {\n${indentedContent}\n${baseIndent}} catch (error) {\n${baseIndent}  ${catchBody}\n${baseIndent}}\n${closingIndent}}`;

  return code.substring(0, bodyStart) + wrapped + code.substring(bodyEnd + 1);
}

/**
 * Add a decorator/annotation before the symbol.
 */
function applyAddDecorator(code: string, params: TransformParams): string {
  if (!params.decorator) throw new Error("add_decorator requires 'decorator'");

  // Detect indentation of the first line
  const leadingWhitespace = code.match(/^(\s*)/)?.[1] || "";

  return `${leadingWhitespace}${params.decorator}\n${code}`;
}

/**
 * Change the return type annotation of a function/method.
 * Works for TypeScript/Dart signatures like `function foo(): OldType {`
 */
function applyChangeReturnType(code: string, params: TransformParams): string {
  if (!params.returnType) throw new Error("change_return_type requires 'returnType'");

  const openParen = code.indexOf("(");
  if (openParen === -1) throw new Error("No parameter list found");

  const closeParen = findMatchingParen(code, openParen);
  if (closeParen === -1) throw new Error("Unmatched parenthesis");

  // Find the colon after close paren (return type annotation)
  const afterParen = code.substring(closeParen + 1);
  const colonMatch = afterParen.match(/^(\s*:\s*)/);

  if (colonMatch) {
    // Has existing return type — find where it ends (at `{`, `=>`, or newline)
    const colonEnd = closeParen + 1 + colonMatch[0].length;
    const rest = code.substring(colonEnd);
    const typeEnd = rest.search(/\s*[{=]/);
    if (typeEnd === -1) throw new Error("Cannot determine return type boundary");

    return (
      code.substring(0, closeParen + 1) +
      `: ${params.returnType}` +
      code.substring(colonEnd + typeEnd)
    );
  }

  // No existing return type — add one after close paren
  return (
    code.substring(0, closeParen + 1) +
    `: ${params.returnType}` +
    code.substring(closeParen + 1)
  );
}

/**
 * Extract an expression into a const variable above its first usage.
 */
function applyExtractVariable(code: string, params: TransformParams): string {
  if (!params.expression) throw new Error("extract_variable requires 'expression'");
  if (!params.variableName) throw new Error("extract_variable requires 'variableName'");

  const exprIndex = code.indexOf(params.expression);
  if (exprIndex === -1) throw new Error(`Expression "${params.expression}" not found in symbol`);

  // Find the start of the line containing the expression
  const lineStart = code.lastIndexOf("\n", exprIndex);
  const linePrefix = code.substring(lineStart + 1, exprIndex);
  const indent = linePrefix.match(/^(\s*)/)?.[1] || "  ";

  const declaration = `${indent}const ${params.variableName} = ${params.expression};\n`;
  const replaced = code.substring(0, exprIndex) + params.variableName + code.substring(exprIndex + params.expression.length);

  // Insert declaration before the line where the expression was found
  const insertPoint = lineStart === -1 ? 0 : lineStart + 1;
  return replaced.substring(0, insertPoint) + declaration + replaced.substring(insertPoint);
}

// ── Utility helpers ────────────────────────────────────────────────────

function findMatchingParen(code: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findMatchingBrace(code: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitParams(paramString: string): string[] {
  const params: string[] = [];
  let depth = 0;
  let current = "";

  for (const ch of paramString) {
    if (ch === "(" || ch === "<" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === ">" || ch === "]" || ch === "}") depth--;

    if (ch === "," && depth === 0) {
      params.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }

  if (current.trim()) params.push(current.trim());
  return params;
}

function detectIndent(body: string): string {
  const lines = body.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return "  ";
  const match = lines[0].match(/^(\s+)/);
  return match ? match[1].substring(0, match[1].length >= 4 ? match[1].length - 2 : match[1].length) : "  ";
}
