/**
 * Zero-Hallucination AST Mock Generator
 * v5.6.0 Enterprise AST Intelligence
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { existsSync } from "node:fs";
import type { Tree, Node } from "web-tree-sitter";
import { ParserRegistry } from "../parsers/registry.js";
import { CodeContextEngine } from "../core/engine.js";
import type { ReadResult } from "./readCore.js";

export interface MockProperty {
  name: string;
  type: string;
  optional: boolean;
  defaultValue: string;
}

export interface AstMockReport {
  symbolName: string;
  kind: "interface" | "type" | "class";
  propertiesCount: number;
  properties: MockProperty[];
  mockCode: string;
  format: "factory" | "fixture" | "inline_json";
  summary: string;
}

export interface AstMockOptions {
  filePath?: string;
  symbolName: string;
  code?: string;
  content?: string;
  format?: "factory" | "fixture" | "inline_json";
  projectRoot?: string;
  registry?: ParserRegistry;
}

/**
 * Derives a deterministic mock value for a given TypeScript/JavaScript type
 */
function deriveDefaultValue(propName: string, rawType: string): string {
  const t = rawType.trim().toLowerCase();

  if (t === "string") return `"mock_${propName}"`;
  if (t === "number") return "100";
  if (t === "boolean") return "true";
  if (t === "date") return 'new Date("2026-01-01T00:00:00.000Z")';
  if (t.endsWith("[]") || t.startsWith("array<")) return "[]";
  if (t.startsWith("record<") || t.startsWith("{")) return "{}";
  if (t.includes("null") && !t.includes("string") && !t.includes("number")) return "null";
  if (t.includes("|")) {
    const firstOption = rawType.split("|")[0].trim();
    if (firstOption.startsWith('"') || firstOption.startsWith("'")) {
      return firstOption;
    }
    return deriveDefaultValue(propName, firstOption);
  }
  return `{} as ${rawType}`;
}

/**
 * Extracts properties from an interface, type alias, or class node
 */
function extractProperties(targetNode: Node): MockProperty[] {
  const props: MockProperty[] = [];

  function findMembers(n: Node) {
    if (n.type === "property_signature" || n.type === "field_definition") {
      const nameNode = n.childForFieldName("name");
      const typeNode = n.childForFieldName("type");
      if (nameNode) {
        const name = nameNode.text;
        const optional = n.text.includes("?") || Boolean(n.children.some(c => Boolean(c && c.type === "?")));
        const rawType = typeNode?.text?.replace(/^:\s*/, "") || "any";
        props.push({
          name,
          type: rawType,
          optional,
          defaultValue: deriveDefaultValue(name, rawType),
        });
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i);
      if (child) findMembers(child);
    }
  }

  findMembers(targetNode);
  return props;
}

/**
 * Generates formatted mock code from extracted properties
 */
function formatMockCode(symbolName: string, props: MockProperty[], format: "factory" | "fixture" | "inline_json"): string {
  const indent = "  ";

  if (format === "inline_json") {
    const obj: Record<string, any> = {};
    for (const p of props) {
      if (p.defaultValue.startsWith('"')) {
        obj[p.name] = p.defaultValue.replace(/^"|"$/g, "");
      } else if (p.defaultValue === "true" || p.defaultValue === "false") {
        obj[p.name] = p.defaultValue === "true";
      } else if (!isNaN(Number(p.defaultValue))) {
        obj[p.name] = Number(p.defaultValue);
      } else if (p.defaultValue === "[]") {
        obj[p.name] = [];
      } else {
        obj[p.name] = p.defaultValue;
      }
    }
    return JSON.stringify(obj, null, 2);
  }

  if (format === "fixture") {
    const lines = props.map(p => `${indent}${p.name}: ${p.defaultValue},`);
    return `export const mock${symbolName}: ${symbolName} = {\n${lines.join("\n")}\n};`;
  }

  // Factory format (default)
  const lines = props.map(p => `${indent}${p.name}: ${p.defaultValue},`);
  return `export const createMock${symbolName} = (overrides?: Partial<${symbolName}>): ${symbolName} => ({\n${lines.join("\n")}\n  ...overrides,\n});`;
}

/**
 * Generates typed mocks from AST definitions
 */
export async function generateAstMocks(params: AstMockOptions): Promise<ReadResult> {
  let tree: Tree | null = null;

  try {
    const targetPath = params.filePath || "in_memory.ts";
    let content = params.code ?? params.content;

    if (content === undefined) {
      if (params.filePath && existsSync(params.filePath)) {
        content = await fs.readFile(params.filePath, "utf-8");
      } else {
        return {
          success: false,
          error: `File does not exist: ${params.filePath || "none"}`,
        };
      }
    }

    const ext = path.extname(targetPath).toLowerCase();

    let registry = params.registry;
    if (!registry) {
      const engine = new CodeContextEngine();
      await engine.init();
      registry = new ParserRegistry(engine);
      await registry.init();
    }

    const parser = registry.getParser(ext === ".py" ? ".py" : ".ts");
    if (!parser) {
      return {
        success: false,
        error: `No parser available for extension: ${ext}`,
      };
    }

    tree = parser.parse(content);

    // Locate symbol
    let targetNode: Node | null = null;
    let targetKind: AstMockReport["kind"] = "interface";

    function findSymbol(n: Node) {
      if (
        n.type === "interface_declaration" ||
        n.type === "type_alias_declaration" ||
        n.type === "class_declaration"
      ) {
        const nameNode = n.childForFieldName("name");
        if (nameNode?.text === params.symbolName) {
          targetNode = n;
          if (n.type === "class_declaration") targetKind = "class";
          else if (n.type === "type_alias_declaration") targetKind = "type";
          return;
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        if (!targetNode) {
          const child = n.namedChild(i);
          if (child) findSymbol(child);
        }
      }
    }

    findSymbol(tree.rootNode);

    if (!targetNode) {
      return {
        success: false,
        error: `Symbol '${params.symbolName}' not found in AST. Checked interface, type, and class declarations.`,
      };
    }

    const props = extractProperties(targetNode);
    const format = params.format || "factory";
    const mockCode = formatMockCode(params.symbolName, props, format);

    const report: AstMockReport = {
      symbolName: params.symbolName,
      kind: targetKind,
      propertiesCount: props.length,
      properties: props,
      mockCode,
      format,
      summary: `Generated ${format} mock for ${targetKind} '${params.symbolName}' with ${props.length} typed fields.`,
    };

    return {
      success: true,
      content: JSON.stringify(report, null, 2),
    };
  } catch (error) {
    return {
      success: false,
      error: `generate_ast_mocks failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    if (tree) {
      try {
        tree.delete();
      } catch {
        // ignore
      }
    }
  }
}
