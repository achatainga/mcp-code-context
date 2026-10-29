/**
 * Trait, Mixin & Inheritance Class Hierarchy Flattener
 * v7.0.0 Enterprise AST Intelligence
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { existsSync } from "node:fs";
import type { Tree, Node } from "web-tree-sitter";
import { ParserRegistry } from "../parsers/registry.js";
import { CodeContextEngine } from "../core/engine.js";
import type { ReadResult } from "./readCore.js";

export interface FlatClassMethod {
  name: string;
  source: "self" | "trait" | "parent";
  originName: string;
  visibility: "public" | "protected" | "private";
  isStatic: boolean;
  signature: string;
  line?: number;
}

export interface FlattenedClassReport {
  className: string;
  parentClass?: string;
  traitsUsed: string[];
  totalMethods: number;
  methods: FlatClassMethod[];
  summary: string;
}

export interface ClassFlattenerOptions {
  filePath?: string;
  className?: string;
  code?: string;
  content?: string;
  projectRoot?: string;
  registry?: ParserRegistry;
}

/**
 * Parses method declarations from a class or trait body
 */
function extractClassMethods(bodyNode: Node, source: FlatClassMethod["source"], originName: string): FlatClassMethod[] {
  const methods: FlatClassMethod[] = [];

  for (let i = 0; i < bodyNode.namedChildCount; i++) {
    const m = bodyNode.namedChild(i);
    if (!m) continue;

    if (
      m.type === "method_declaration" ||
      m.type === "method_definition" ||
      m.type === "function_definition"
    ) {
      const name = m.childForFieldName("name")?.text || "anonymous";
      const text = m.text;
      let visibility: FlatClassMethod["visibility"] = "public";
      if (text.includes("private ")) visibility = "private";
      else if (text.includes("protected ")) visibility = "protected";

      const isStatic = text.includes("static ");
      const firstLine = text.split("\n")[0].replace(/\{.*$/, "").trim();

      methods.push({
        name,
        source,
        originName,
        visibility,
        isStatic,
        signature: firstLine,
        line: m.startPosition.row + 1,
      });
    }
  }

  return methods;
}

/**
 * Flattens class traits, mixins and methods
 */
export async function flattenClassHierarchy(params: ClassFlattenerOptions): Promise<ReadResult> {
  let tree: Tree | null = null;

  try {
    const targetPath = params.filePath || "in_memory.php";
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

    const parser = registry.getParser(ext === ".php" ? ".php" : ext === ".py" ? ".py" : ".ts");
    if (!parser) {
      return {
        success: false,
        error: `No parser available for extension: ${ext}`,
      };
    }

    tree = parser.parse(content);

    // Locate target class
    let classNode: Node | null = null;
    let resolvedClassName = params.className || "UnknownClass";
    let parentClass: string | undefined = undefined;
    const traitsUsed: string[] = [];

    function findClass(n: Node) {
      if (
        n.type === "class_declaration" ||
        n.type === "class_definition"
      ) {
        const nameNode = n.childForFieldName("name");
        if (!params.className || nameNode?.text === params.className) {
          classNode = n;
          resolvedClassName = nameNode?.text || resolvedClassName;
          return;
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        if (!classNode) {
          const child = n.namedChild(i);
          if (child) findClass(child);
        }
      }
    }

    findClass(tree.rootNode);

    if (!classNode) {
      return {
        success: false,
        error: `Class '${params.className || "first"}' not found in AST.`,
      };
    }

    const targetClass = classNode as Node;

    // Check base class (extends)
    const baseNode = targetClass.childForFieldName("base") || targetClass.childForFieldName("superclasses");
    if (baseNode) {
      parentClass = baseNode.text.replace(/^extends\s+/i, "");
    }

    const classBody = targetClass.childForFieldName("body") || targetClass.namedChild(targetClass.namedChildCount - 1);
    const methods: FlatClassMethod[] = [];

    if (classBody) {
      // 1. Detect trait usages: use PluginManagementTrait, ThemeManagementTrait;
      for (let i = 0; i < classBody.namedChildCount; i++) {
        const child = classBody.namedChild(i);
        if (!child) continue;

        if (child.type === "use_declaration" || child.text.startsWith("use ")) {
          // Extract trait names from use statement
          const traitMatches = child.text.replace(/^use\s+/, "").replace(/;.*$/, "").split(",");
          for (const rawTrait of traitMatches) {
            const cleanTrait = rawTrait.trim();
            if (cleanTrait) traitsUsed.push(cleanTrait);
          }
        }
      }

      // 2. Extract self methods
      const selfMethods = extractClassMethods(classBody, "self", resolvedClassName);
      methods.push(...selfMethods);
    }

    // 3. Synthesize virtual trait methods if defined in same file
    for (const traitName of traitsUsed) {
      function findTrait(n: Node) {
        if (n.type === "trait_declaration" && n.childForFieldName("name")?.text === traitName) {
          const traitBody = n.childForFieldName("body") || n.namedChild(n.namedChildCount - 1);
          if (traitBody) {
            const traitMethods = extractClassMethods(traitBody, "trait", traitName);
            methods.push(...traitMethods);
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i);
          if (child) findTrait(child);
        }
      }
      findTrait(tree.rootNode);
    }

    const report: FlattenedClassReport = {
      className: resolvedClassName,
      parentClass,
      traitsUsed,
      totalMethods: methods.length,
      methods,
      summary: `Flattened class '${resolvedClassName}'. Uses ${traitsUsed.length} traits. Total resolved methods: ${methods.length}.`,
    };

    return {
      success: true,
      content: JSON.stringify(report, null, 2),
    };
  } catch (error) {
    return {
      success: false,
      error: `flatten_class_hierarchy failed: ${error instanceof Error ? error.message : String(error)}`,
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
