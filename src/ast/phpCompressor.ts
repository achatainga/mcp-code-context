/**
 * phpCompressor — AST-based PHP semantic compressor.
 *
 * Uses the `php-parser` npm package (Glayzzle) to parse PHP source code
 * into a real Abstract Syntax Tree, then extracts only structural
 * signatures: namespaces, use statements, classes, interfaces, traits,
 * enums, functions, methods, properties, and constants — stripping all
 * implementation bodies.
 *
 * This gives PHP the same first-class treatment that TypeScript gets
 * via ts-morph: true AST parsing, not regex hacks.
 */

import { createRequire } from "node:module";

// php-parser is a CJS package — use createRequire for ESM compatibility
const require = createRequire(import.meta.url);
const Engine = require("php-parser");

// ─── Types for php-parser AST nodes ────────────────────────────────

interface PhpNode {
  kind: string;
  name?: string | { name: string; kind: string };
  children?: PhpNode[];
  body?: PhpNode[] | PhpNode;
  items?: PhpNode[];
  cases?: PhpNode[];
  traits?: PhpNode[];
  adaptations?: PhpNode[];
  arguments?: PhpNode[];

  // Class / Interface / Trait / Enum
  extends?: PhpNode | PhpNode[];
  implements?: PhpNode[];
  isAbstract?: boolean;
  isFinal?: boolean;
  isReadonly?: boolean;

  // Methods / Functions
  visibility?: string;
  isStatic?: boolean;
  nullable?: boolean;
  type?: PhpNode | string | null;
  value?: PhpNode | string | null;
  byref?: boolean;
  variadic?: boolean;

  // Properties
  properties?: PhpNode[];

  // Use statements
  aliases?: PhpNode[];

  // Constants
  constants?: PhpNode[];

  // Enum backing type
  valueType?: PhpNode | string | null;

  // Union / Intersection types
  types?: PhpNode[];

  // Comments / DocBlocks
  leadingComments?: Array<{ kind: string; value: string }>;

  // Location (for symbol extraction)
  loc?: {
    start: { line: number; column: number; offset: number };
    end: { line: number; column: number; offset: number };
  };
}

// ─── Singleton Parser ──────────────────────────────────────────────

let _parser: any = null;

function getParser(): any {
  if (!_parser) {
    _parser = new Engine({
      parser: {
        extractDoc: true,
        php7: true,
        php8: true,
        suppressErrors: true,
      },
      ast: {
        withPositions: true,
        withSource: false,
      },
    });
  }
  return _parser;
}

// ─── Public API ────────────────────────────────────────────────────

/**
 * Compress a PHP file into its semantic skeleton.
 * Returns only structural signatures — no function/method bodies.
 */
export function compressPHP(content: string): string {
  const parser = getParser();

  let ast: PhpNode;
  try {
    ast = parser.parseCode(content, "file.php");
  } catch {
    // If parsing fails, return a truncated preview
    const lines = content.split("\n");
    if (lines.length > 80) {
      return [
        "// ⚠️ PHP AST parsing failed — showing first 60 lines",
        "",
        ...lines.slice(0, 60),
        "",
        `// ... (${lines.length - 60} more lines truncated)`,
      ].join("\n");
    }
    return content;
  }

  const result: string[] = [];
  processNode(ast, result, 0);
  return result.join("\n");
}

/**
 * Extract the full source code of a named symbol from a PHP file.
 * Supports classes, interfaces, traits, enums, functions, and methods.
 * Returns null if the symbol is not found.
 */
export function extractPHPSymbol(
  content: string,
  symbolName: string,
): string | null {
  const parser = getParser();

  let ast: PhpNode;
  try {
    ast = parser.parseCode(content, "file.php");
  } catch {
    return null;
  }

  const lines = content.split("\n");
  const node = findSymbolNode(ast, symbolName);

  if (!node || !node.loc) {
    return null;
  }

  // Extract lines from source using the node's location
  const startLine = node.loc.start.line - 1; // 0-indexed
  const endLine = node.loc.end.line; // exclusive

  // For class-level symbols, also capture leading docblock
  let actualStart = startLine;
  if (node.leadingComments && node.leadingComments.length > 0) {
    // Walk backward from startLine to find the docblock
    for (let i = startLine - 1; i >= 0; i--) {
      const trimmed = lines[i].trim();
      if (
        trimmed.startsWith("/**") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("*/") ||
        trimmed.startsWith("//") ||
        trimmed.startsWith("#[")
      ) {
        actualStart = i;
      } else if (trimmed === "") {
        continue;
      } else {
        break;
      }
    }
  }

  const extracted = lines.slice(actualStart, endLine);

  // Trim trailing empty lines
  while (extracted.length > 0 && extracted[extracted.length - 1].trim() === "") {
    extracted.pop();
  }

  return extracted.join("\n");
}

// ─── AST Traversal & Compression ───────────────────────────────────

function processNode(node: PhpNode, result: string[], depth: number): void {
  if (!node) return;

  switch (node.kind) {
    case "program":
      processChildren(node, result, depth);
      break;

    case "namespace":
      processNamespace(node, result, depth);
      break;

    case "usegroup":
      processUseGroup(node, result, depth);
      break;

    case "class":
      processClass(node, result, depth);
      break;

    case "interface":
      processInterface(node, result, depth);
      break;

    case "trait":
      processTrait(node, result, depth);
      break;

    case "enum":
      processEnum(node, result, depth);
      break;

    case "function":
      processFunction(node, result, depth);
      break;

    case "expressionstatement":
      // Top-level expressions (e.g., define('CONST', value))
      processExpression(node, result, depth);
      break;

    case "if":
      // Top-level guards like: if (!defined('ABSPATH')) exit;
      // Skip these — they're boilerplate
      break;

    default:
      // Other top-level nodes we don't care about for compression
      break;
  }
}

function processChildren(node: PhpNode, result: string[], depth: number): void {
  const children = node.children || node.body;
  if (Array.isArray(children)) {
    for (const child of children) {
      processNode(child, result, depth);
    }
  }
}

// ─── Namespace ─────────────────────────────────────────────────────

function processNamespace(node: PhpNode, result: string[], depth: number): void {
  const name = getNodeName(node);
  if (name) {
    result.push(`namespace ${name};`);
    result.push("");
  }

  // Process use statements first, then other declarations
  const children = node.children || [];
  const useGroups: PhpNode[] = [];
  const declarations: PhpNode[] = [];

  for (const child of children) {
    if (child.kind === "usegroup") {
      useGroups.push(child);
    } else {
      declarations.push(child);
    }
  }

  // Emit use statements
  if (useGroups.length > 0) {
    for (const ug of useGroups) {
      processUseGroup(ug, result, depth);
    }
    result.push("");
  }

  // Emit declarations
  for (const decl of declarations) {
    processNode(decl, result, depth);
  }
}

// ─── Use Statements ────────────────────────────────────────────────

function processUseGroup(node: PhpNode, result: string[], _depth: number): void {
  const items = node.items || [];
  for (const item of items) {
    const name = getNodeName(item);
    if (name) {
      const alias =
        item.aliases && item.aliases.length > 0
          ? ` as ${getNodeName(item.aliases[0])}`
          : "";
      result.push(`use ${name}${alias};`);
    }
  }
}

// ─── Class ─────────────────────────────────────────────────────────

function processClass(node: PhpNode, result: string[], depth: number): void {
  const indent = makeIndent(depth);

  // Emit docblock
  emitDocBlock(node, result, indent);

  // Build class header
  const parts: string[] = [];
  if (node.isAbstract) parts.push("abstract");
  if (node.isFinal) parts.push("final");
  if (node.isReadonly) parts.push("readonly");
  parts.push("class");
  parts.push(getNodeName(node));

  if (node.extends) {
    const extName = getNodeName(node.extends as PhpNode);
    if (extName) parts.push(`extends ${extName}`);
  }

  if (node.implements && node.implements.length > 0) {
    const impls = node.implements.map((i) => getNodeName(i)).filter(Boolean);
    if (impls.length > 0) parts.push(`implements ${impls.join(", ")}`);
  }

  result.push(`${indent}${parts.join(" ")} {`);

  // Process class body
  const body = Array.isArray(node.body) ? node.body : [];
  processClassBody(body, result, depth + 1);

  result.push(`${indent}}`);
  result.push("");
}

// ─── Interface ─────────────────────────────────────────────────────

function processInterface(node: PhpNode, result: string[], depth: number): void {
  const indent = makeIndent(depth);

  emitDocBlock(node, result, indent);

  const parts: string[] = ["interface", getNodeName(node)];

  if (node.extends && Array.isArray(node.extends) && node.extends.length > 0) {
    const exts = node.extends.map((e: PhpNode) => getNodeName(e)).filter(Boolean);
    if (exts.length > 0) parts.push(`extends ${exts.join(", ")}`);
  }

  result.push(`${indent}${parts.join(" ")} {`);

  const body = Array.isArray(node.body) ? node.body : [];
  processClassBody(body, result, depth + 1);

  result.push(`${indent}}`);
  result.push("");
}

// ─── Trait ─────────────────────────────────────────────────────────

function processTrait(node: PhpNode, result: string[], depth: number): void {
  const indent = makeIndent(depth);

  emitDocBlock(node, result, indent);

  result.push(`${indent}trait ${getNodeName(node)} {`);

  const body = Array.isArray(node.body) ? node.body : [];
  processClassBody(body, result, depth + 1);

  result.push(`${indent}}`);
  result.push("");
}

// ─── Enum ──────────────────────────────────────────────────────────

function processEnum(node: PhpNode, result: string[], depth: number): void {
  const indent = makeIndent(depth);
  const innerIndent = makeIndent(depth + 1);

  emitDocBlock(node, result, indent);

  let header = `enum ${getNodeName(node)}`;

  // Backing type (e.g., enum Color: string)
  if (node.valueType) {
    const backingType = typeof node.valueType === "string"
      ? node.valueType
      : getNodeName(node.valueType as PhpNode);
    if (backingType) header += `: ${backingType}`;
  }

  if (node.implements && node.implements.length > 0) {
    const impls = node.implements.map((i) => getNodeName(i)).filter(Boolean);
    if (impls.length > 0) header += ` implements ${impls.join(", ")}`;
  }

  result.push(`${indent}${header} {`);

  // Emit cases
  const body = Array.isArray(node.body) ? node.body : [];
  for (const member of body) {
    if (member.kind === "enumcase") {
      const caseName = getNodeName(member);
      if (member.value) {
        const val = extractLiteralValue(member.value as PhpNode);
        result.push(`${innerIndent}case ${caseName} = ${val};`);
      } else {
        result.push(`${innerIndent}case ${caseName};`);
      }
    } else if (member.kind === "method") {
      processMethod(member, result, depth + 1);
    } else if (member.kind === "classconstant") {
      processClassConstant(member, result, depth + 1);
    } else if (member.kind === "traituse") {
      processTraitUse(member, result, depth + 1);
    }
  }

  result.push(`${indent}}`);
  result.push("");
}

// ─── Class Body (shared by class, interface, trait) ────────────────

function processClassBody(
  body: PhpNode[],
  result: string[],
  depth: number,
): void {
  // Group members by type for clean output
  const traitUses: PhpNode[] = [];
  const constants: PhpNode[] = [];
  const properties: PhpNode[] = [];
  const methods: PhpNode[] = [];

  for (const member of body) {
    switch (member.kind) {
      case "traituse":
        traitUses.push(member);
        break;
      case "classconstant":
        constants.push(member);
        break;
      case "propertystatement":
        properties.push(member);
        break;
      case "method":
        methods.push(member);
        break;
      default:
        // Other node types we might encounter
        break;
    }
  }

  // Emit trait uses first
  for (const tu of traitUses) {
    processTraitUse(tu, result, depth);
  }

  // Then constants
  for (const c of constants) {
    processClassConstant(c, result, depth);
  }

  // Then properties
  for (const p of properties) {
    processProperty(p, result, depth);
  }

  // Then methods (signature only)
  for (const m of methods) {
    processMethod(m, result, depth);
  }
}

// ─── Trait Use ──────────────────────────────────────────────────────

function processTraitUse(node: PhpNode, result: string[], depth: number): void {
  const indent = makeIndent(depth);
  const traits = node.traits || [];
  const names = traits.map((t) => getNodeName(t)).filter(Boolean);
  if (names.length > 0) {
    result.push(`${indent}use ${names.join(", ")};`);
  }
}

// ─── Class Constants ───────────────────────────────────────────────

function processClassConstant(node: PhpNode, result: string[], depth: number): void {
  const indent = makeIndent(depth);
  const vis = node.visibility ? `${node.visibility} ` : "";

  const constants = node.constants || [];
  for (const c of constants) {
    const name = getNodeName(c);
    const val = c.value ? extractLiteralValue(c.value as PhpNode) : "/* ... */";
    emitDocBlock(node, result, indent);
    result.push(`${indent}${vis}const ${name} = ${val};`);
  }
}

// ─── Properties ────────────────────────────────────────────────────

function processProperty(node: PhpNode, result: string[], depth: number): void {
  const indent = makeIndent(depth);
  const vis = node.visibility ? `${node.visibility} ` : "";
  const isStatic = node.isStatic ? "static " : "";
  const isReadonly = node.isReadonly ? "readonly " : "";

  emitDocBlock(node, result, indent);

  const properties = node.properties || [];
  for (const prop of properties) {
    const name = getNodeName(prop);
    const typeName = node.type ? buildTypeString(node.type) + " " : "";
    const nullable = node.nullable ? "?" : "";
    const defaultVal = prop.value ? ` = ${extractLiteralValue(prop.value as PhpNode)}` : "";
    result.push(
      `${indent}${vis}${isStatic}${isReadonly}${nullable}${typeName}$${name}${defaultVal};`,
    );
  }
}

// ─── Methods ───────────────────────────────────────────────────────

function processMethod(node: PhpNode, result: string[], depth: number): void {
  const indent = makeIndent(depth);

  emitDocBlock(node, result, indent);

  const parts: string[] = [];
  if (node.isAbstract) parts.push("abstract");
  if (node.visibility) parts.push(node.visibility);
  if (node.isStatic) parts.push("static");
  parts.push("function");

  const name = getNodeName(node);
  const params = buildParameterList(node);
  const returnType = buildReturnType(node);

  if (node.isAbstract) {
    result.push(`${indent}${parts.join(" ")} ${name}(${params})${returnType};`);
  } else {
    result.push(`${indent}${parts.join(" ")} ${name}(${params})${returnType} { /* ... */ }`);
  }
}

// ─── Top-level Functions ───────────────────────────────────────────

function processFunction(node: PhpNode, result: string[], depth: number): void {
  const indent = makeIndent(depth);

  emitDocBlock(node, result, indent);

  const name = getNodeName(node);
  const params = buildParameterList(node);
  const returnType = buildReturnType(node);

  result.push(`${indent}function ${name}(${params})${returnType} { /* ... */ }`);
  result.push("");
}

// ─── Expressions (define, etc.) ────────────────────────────────────

function processExpression(node: PhpNode, result: string[], _depth: number): void {
  // Look for define() calls
  const expr = (node as any).expression;
  if (!expr) return;

  if (expr.kind === "call") {
    const callName = getNodeName(expr);
    if (callName === "define" && expr.arguments && expr.arguments.length >= 2) {
      const constName = extractLiteralValue(expr.arguments[0]);
      const constVal = extractLiteralValue(expr.arguments[1]);
      result.push(`define(${constName}, ${constVal});`);
    }
  }
}

// ─── Parameter List Builder ────────────────────────────────────────

function buildParameterList(node: PhpNode): string {
  const args = node.arguments || [];
  return args
    .filter((a) => a.kind === "parameter")
    .map((param) => {
      const parts: string[] = [];

      // Visibility for promoted properties (PHP 8.0+)
      if (param.visibility) parts.push(param.visibility);
      if (param.isReadonly) parts.push("readonly");

      // Type
      if (param.type) {
        const nullable = param.nullable ? "?" : "";
        parts.push(nullable + buildTypeString(param.type));
      }

      // Variadic
      const variadic = param.variadic ? "..." : "";
      const byref = param.byref ? "&" : "";

      parts.push(`${byref}${variadic}$${getNodeName(param)}`);

      // Default value
      if (param.value) {
        const val = extractLiteralValue(param.value as PhpNode);
        parts.push(`= ${val}`);
      }

      return parts.join(" ");
    })
    .join(", ");
}

// ─── Return Type Builder ───────────────────────────────────────────

function buildReturnType(node: PhpNode): string {
  if (!node.type) return "";
  const nullable = node.nullable ? "?" : "";
  return `: ${nullable}${buildTypeString(node.type)}`;
}

// ─── Type String Builder ───────────────────────────────────────────

function buildTypeString(type: PhpNode | string | null): string {
  if (!type) return "";
  if (typeof type === "string") return type;

  switch (type.kind) {
    case "typereference":
    case "name":
    case "selfreference":
    case "staticreference":
    case "parentreference":
      return getNodeName(type) || type.kind;

    case "uniontype":
      return (type.types || [])
        .map((t) => buildTypeString(t))
        .join("|");

    case "intersectiontype":
      return (type.types || [])
        .map((t) => buildTypeString(t))
        .join("&");

    case "nullabletype":
      return `?${buildTypeString((type as any).type)}`;

    default:
      return getNodeName(type) || "";
  }
}

// ─── Symbol Finder (for extractPHPSymbol) ──────────────────────────

function findSymbolNode(
  node: PhpNode,
  symbolName: string,
): PhpNode | null {
  if (!node) return null;

  const nodeName = getNodeName(node);

  // Direct match on class, interface, trait, enum, function
  if (
    ["class", "interface", "trait", "enum", "function"].includes(node.kind) &&
    nodeName === symbolName
  ) {
    return node;
  }

  // Search methods inside classes/interfaces/traits/enums
  if (["class", "interface", "trait", "enum"].includes(node.kind)) {
    const body = Array.isArray(node.body) ? node.body : [];
    for (const member of body) {
      if (member.kind === "method" && getNodeName(member) === symbolName) {
        return member;
      }
    }
  }

  // Recursive search through children
  const allChildren = [
    ...(node.children || []),
    ...(Array.isArray(node.body) ? node.body : []),
  ];

  for (const child of allChildren) {
    const found = findSymbolNode(child, symbolName);
    if (found) return found;
  }

  return null;
}

// ─── Utility Functions ─────────────────────────────────────────────

function getNodeName(node: PhpNode | undefined | null): string {
  if (!node) return "";
  if (typeof node.name === "string") return node.name;
  if (node.name && typeof node.name === "object" && "name" in node.name) {
    return node.name.name;
  }
  // For typereference, name might be at the node level directly
  if (node.kind === "typereference" || node.kind === "name") {
    return (node as any).name || (node as any).resolution || "";
  }
  if (node.kind === "selfreference") return "self";
  if (node.kind === "staticreference") return "static";
  if (node.kind === "parentreference") return "parent";
  return "";
}

function extractLiteralValue(node: PhpNode): string {
  if (!node) return "/* ... */";

  switch (node.kind) {
    case "string":
      return `'${(node as any).value || ""}'`;
    case "number":
      return String((node as any).value || 0);
    case "boolean":
      return (node as any).value ? "true" : "false";
    case "nullkeyword":
      return "null";
    case "nowdoc":
    case "encapsed":
      return "'...'";
    case "array":
      return "[/* ... */]";
    case "staticlookup":
    case "propertylookup":
      return "/* ... */";
    default:
      return "/* ... */";
  }
}

function emitDocBlock(
  node: PhpNode,
  result: string[],
  indent: string,
): void {
  if (!node.leadingComments || node.leadingComments.length === 0) return;

  for (const comment of node.leadingComments) {
    if (comment.kind === "commentblock" && comment.value.startsWith("/**")) {
      // This is a PHPDoc block — emit it
      const docLines = comment.value.split("\n");
      for (const line of docLines) {
        result.push(`${indent}${line.trim()}`);
      }
    }
  }
}

function makeIndent(depth: number): string {
  return "    ".repeat(depth);
}
