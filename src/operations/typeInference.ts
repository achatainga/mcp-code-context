/**
 * AST Duck-Type Backfiller & Type Inference Engine (v4.5.0)
 * 
 * Inspects AST property accesses (param.id, param.name.trim(), param.age > 18, param.save()),
 * method invocations, binary operations, subscript lookups, and return statements in
 * untyped JavaScript, TypeScript, or Python codebases.
 * Automatically backfills strict TypeScript interfaces or Python TypedDict / BaseModel definitions.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { existsSync } from "node:fs";
import { ParserRegistry } from "../parsers/registry.js";
import { CodeContextEngine } from "../core/engine.js";
import type { ReadResult } from "./readCore.js";
import type { Node, Tree } from "web-tree-sitter";

export interface InferredProperty {
  name: string;
  type: string;
  optional: boolean;
  contextSnippet: string;
  confidence: "HIGH" | "MEDIUM" | "HEURISTIC";
}

export interface InferredParameterType {
  parameterName: string;
  targetTypeName: string;
  properties: InferredProperty[];
  methods: Array<{
    name: string;
    params: string[];
    returnType: string;
  }>;
  generatedInterface: string;
}

export interface FunctionTypeInference {
  functionName: string;
  startLine: number;
  endLine: number;
  parameters: InferredParameterType[];
  inferredReturnType: string;
  annotatedSignature: string;
}

export interface TypeInferenceReport {
  filePath: string;
  targetLanguage: "typescript" | "python";
  functionsCount: number;
  inferences: FunctionTypeInference[];
  combinedTypeDefinitions: string;
}

/**
 * Standard method signatures for type resolution
 */
const STRING_METHODS = new Set([
  "trim", "trimStart", "trimEnd", "toLowerCase", "toUpperCase", "toLocaleLowerCase",
  "toLocaleUpperCase", "slice", "substring", "substr", "replace", "replaceAll",
  "startsWith", "endsWith", "split", "indexOf", "lastIndexOf", "padStart", "padEnd",
  "strip", "lstrip", "rstrip", "lower", "upper", "capitalize", "title"
]);

const NUMBER_METHODS = new Set([
  "toFixed", "toPrecision", "toExponential", "valueOf"
]);

const ARRAY_METHODS = new Set([
  "map", "filter", "forEach", "find", "findIndex", "findLast", "findLastIndex",
  "some", "every", "reduce", "reduceRight", "push", "pop", "shift", "unshift",
  "splice", "slice", "sort", "reverse", "join", "flat", "flatMap", "includes",
  "append", "extend", "insert", "remove"
]);

const DATE_METHODS = new Set([
  "getTime", "toISOString", "getFullYear", "getMonth", "getDate", "getDay",
  "getHours", "getMinutes", "getSeconds", "getMilliseconds", "toUTCString"
]);

/**
 * Heuristics for property names when no operator or method is called
 */
function inferTypeFromName(name: string, targetLang: "typescript" | "python"): { type: string; confidence: "HEURISTIC" | "MEDIUM" } {
  const lower = name.toLowerCase();

  // Boolean flags
  if (/^(is|has|can|should|enable|allow|with)[A-Z_]/.test(name) || /^(active|enabled|valid|done|success|checked|required|visible)$/.test(lower)) {
    return { type: targetLang === "python" ? "bool" : "boolean", confidence: "MEDIUM" };
  }

  // Numeric fields
  if (/^(count|total|amount|price|sum|cost|score|rating|limit|offset|index|size|length|quantity|width|height|age|balance|discount)$/.test(lower) ||
      /.*(Count|Total|Amount|Price|Sum|Cost|Score|Rating|Limit|Offset|Index|Size|Length|Quantity|Width|Height|Age|Balance|Discount)$/.test(name)) {
    return { type: targetLang === "python" ? "int" : "number", confidence: "MEDIUM" };
  }

  // Identity / string identifiers
  if (/^(id|_id|uuid|guid)$/.test(lower) || /.*(Id|Uuid|Guid)$/.test(name)) {
    return { type: targetLang === "python" ? "Union[str, int]" : "string | number", confidence: "MEDIUM" };
  }

  // String textual fields
  if (/^(name|title|description|email|username|slug|url|path|message|content|text|notes|comment|query|token|hash|secret|password|address|country|city|state|zip|phone)$/.test(lower) ||
      /.*(Name|Title|Description|Email|Username|Slug|Url|Path|Message|Content|Text|Notes|Comment|Query|Token|Hash|Secret|Password|Address|Phone)$/.test(name)) {
    return { type: targetLang === "python" ? "str" : "string", confidence: "MEDIUM" };
  }

  // Array / list collections
  if (/.*(List|s|items|records|elements|entries)$/.test(name) && !/^(status|address|process|access|class)$/.test(lower)) {
    return { type: targetLang === "python" ? "List[Any]" : "any[]", confidence: "HEURISTIC" };
  }

  // Date fields
  if (/^(date|timestamp|createdat|updatedat|deletedat)$/.test(lower) || /.*(Date|Timestamp|At)$/.test(name)) {
    return { type: targetLang === "python" ? "datetime" : "Date", confidence: "MEDIUM" };
  }

  return { type: targetLang === "python" ? "Any" : "any", confidence: "HEURISTIC" };
}

/**
 * Capitalizes string to PascalCase for interface names
 */
function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase())
    .replace(/^[a-z]/, (c) => c.toUpperCase());
}

/**
 * Analyzes property access on a specific parameter inside a function block
 */
function analyzeParameterUsage(
  funcNode: Node,
  paramName: string,
  targetLang: "typescript" | "python",
  code: string
): { properties: Map<string, InferredProperty>; methods: Map<string, { params: string[]; returnType: string }> } {
  const properties = new Map<string, InferredProperty>();
  const methods = new Map<string, { params: string[]; returnType: string }>();

  function visit(node: Node) {
    // 1. Member expression / attribute (e.g. param.property)
    if (
      (node.type === "member_expression" && targetLang === "typescript") ||
      (node.type === "attribute" && targetLang === "python")
    ) {
      let objectNode: Node | null = null;
      let propertyNode: Node | null = null;

      if (targetLang === "typescript") {
        objectNode = node.childForFieldName("object");
        propertyNode = node.childForFieldName("property");
      } else {
        objectNode = node.childForFieldName("object");
        propertyNode = node.childForFieldName("attribute");
      }

      if (objectNode && propertyNode && objectNode.text === paramName) {
        const propName = propertyNode.text;
        const parent = node.parent;
        const grandParent = parent?.parent;
        const rawSnippet = node.text;

        // Check if optional chaining was used
        const isOptional = node.text.includes("?.") || (parent && parent.text.includes("?."));

        // Case A: Method call (e.g. param.save(), param.name.trim())
        if (parent && (parent.type === "call_expression" || parent.type === "call") && parent.childForFieldName("function")?.id === node.id) {
          if (STRING_METHODS.has(propName)) {
            // Property was called as a string method directly on param -> param itself is string (or param[prop] handled)
          } else if (ARRAY_METHODS.has(propName)) {
            // param itself called as array method
          } else {
            // It's a method on the parameter object
            methods.set(propName, {
              params: [],
              returnType: targetLang === "python" ? "Any" : "any",
            });
            return;
          }
        }

        // Check how the property is used
        let inferredType = targetLang === "python" ? "Any" : "any";
        let confidence: "HIGH" | "MEDIUM" | "HEURISTIC" = "HEURISTIC";

        if (parent) {
          // A1: Followed by method call on property: param.prop.trim() or param.prop.map()
          if ((parent.type === "member_expression" || parent.type === "attribute") && grandParent && (grandParent.type === "call_expression" || grandParent.type === "call")) {
            const calledMethod = parent.childForFieldName(targetLang === "typescript" ? "property" : "attribute")?.text || "";
            if (STRING_METHODS.has(calledMethod)) {
              inferredType = targetLang === "python" ? "str" : "string";
              confidence = "HIGH";
            } else if (ARRAY_METHODS.has(calledMethod)) {
              inferredType = targetLang === "python" ? "List[Any]" : "any[]";
              confidence = "HIGH";
            } else if (NUMBER_METHODS.has(calledMethod)) {
              inferredType = targetLang === "python" ? "int" : "number";
              confidence = "HIGH";
            } else if (DATE_METHODS.has(calledMethod)) {
              inferredType = targetLang === "python" ? "datetime" : "Date";
              confidence = "HIGH";
            }
          }

          // A2: Binary expression: arithmetic or comparison
          if (confidence !== "HIGH" && (parent.type === "binary_expression" || parent.type === "binary_operator")) {
            const parentText = parent.text;
            if (/[+\-*/%<>]=?/.test(parentText)) {
              if (/[*\/%<>]/.test(parentText) || parentText.includes("-") || parentText.includes(">") || parentText.includes("<")) {
                inferredType = targetLang === "python" ? "int" : "number";
                confidence = "HIGH";
              } else if (parentText.includes("+")) {
                // If other operand is string literal or number
                if (/['"`]/.test(parentText)) {
                  inferredType = targetLang === "python" ? "str" : "string";
                  confidence = "HIGH";
                } else {
                  inferredType = targetLang === "python" ? "Union[int, str]" : "number | string";
                  confidence = "MEDIUM";
                }
              }
            } else if (parentText.includes("===") || parentText.includes("==") || parentText.includes("!=")) {
              if (/['"`]/.test(parentText)) {
                inferredType = targetLang === "python" ? "str" : "string";
                confidence = "HIGH";
              } else if (/\b(true|false|True|False)\b/.test(parentText)) {
                inferredType = targetLang === "python" ? "bool" : "boolean";
                confidence = "HIGH";
              } else if (/\b\d+\b/.test(parentText)) {
                inferredType = targetLang === "python" ? "int" : "number";
                confidence = "HIGH";
              }
            }
          }

          // A3: Unary expression (!param.prop, +param.prop)
          if (confidence !== "HIGH" && (parent.type === "unary_expression" || parent.type === "unary_operator")) {
            const op = parent.child(0)?.text || parent.text[0];
            if (op === "!") {
              inferredType = targetLang === "python" ? "bool" : "boolean";
              confidence = "HIGH";
            } else if (op === "+" || op === "-") {
              inferredType = targetLang === "python" ? "int" : "number";
              confidence = "HIGH";
            }
          }

          // A4: Subscript indexing (param.prop[0])
          if (confidence !== "HIGH" && (parent.type === "subscript_expression" || parent.type === "subscript")) {
            inferredType = targetLang === "python" ? "List[Any]" : "any[]";
            confidence = "HIGH";
          }
        }

        // If still heuristic, infer from property name
        if (confidence === "HEURISTIC") {
          const named = inferTypeFromName(propName, targetLang);
          inferredType = named.type;
          confidence = named.confidence;
        }

        const existing = properties.get(propName);
        if (!existing || (confidence === "HIGH" && existing.confidence !== "HIGH")) {
          properties.set(propName, {
            name: propName,
            type: inferredType,
            optional: isOptional || (existing ? existing.optional : false),
            contextSnippet: node.parent?.text.slice(0, 80) || rawSnippet,
            confidence,
          });
        }
      }
    }

    // 2. Destructuring in JS: const { id, name, email = "default" } = param;
    if (targetLang === "typescript" && node.type === "variable_declarator") {
      const init = node.childForFieldName("value") || node.childForFieldName("init");
      const pattern = node.childForFieldName("name");
      if (init && init.text === paramName && pattern && pattern.type === "object_pattern") {
        for (let i = 0; i < pattern.childCount; i++) {
          const child = pattern.child(i);
          if (!child) continue;

          let propName = "";
          let isOptional = false;
          let defaultValueType: string | null = null;

          if (child.type === "shorthand_property_identifier_pattern" || child.type === "shorthand_property_identifier") {
            propName = child.text;
          } else if (child.type === "object_assignment_pattern") {
            const left = child.child(0);
            const right = child.child(2);
            if (left) propName = left.text;
            isOptional = true;
            if (right) {
              if (right.type === "string") defaultValueType = "string";
              else if (right.type === "number") defaultValueType = "number";
              else if (right.type === "true" || right.type === "false") defaultValueType = "boolean";
              else if (right.type === "array") defaultValueType = "any[]";
            }
          } else if (child.type === "pair_pattern") {
            const key = child.childForFieldName("key");
            if (key) propName = key.text;
          }

          if (propName) {
            const inferred = defaultValueType || inferTypeFromName(propName, targetLang).type;
            properties.set(propName, {
              name: propName,
              type: inferred,
              optional: isOptional,
              contextSnippet: node.text.slice(0, 80),
              confidence: defaultValueType ? "HIGH" : "MEDIUM",
            });
          }
        }
      }
    }

    // Recurse children
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) visit(child);
    }
  }

  visit(funcNode);
  return { properties, methods };
}

/**
 * Infers return type of a function based on return_statements in its body
 */
function inferReturnType(funcNode: Node, targetLang: "typescript" | "python", isAsync: boolean): string {
  const returnStatements: Node[] = [];

  function findReturns(node: Node) {
    if (node.type === "return_statement") {
      returnStatements.push(node);
      return;
    }
    // Don't recurse into inner nested functions
    if (node.id !== funcNode.id && (node.type.includes("function") || node.type === "arrow_function")) {
      return;
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c) findReturns(c);
    }
  }

  findReturns(funcNode);

  let baseType = targetLang === "python" ? "None" : "void";

  if (returnStatements.length > 0) {
    const typesFound = new Set<string>();

    for (const ret of returnStatements) {
      const expr = ret.namedChild(0);
      if (!expr) continue;

      const txt = expr.text;
      if (expr.type === "string" || expr.type === "string_literal" || expr.type === "template_string") {
        typesFound.add(targetLang === "python" ? "str" : "string");
      } else if (expr.type === "number" || expr.type === "integer" || expr.type === "float") {
        typesFound.add(targetLang === "python" ? "int" : "number");
      } else if (expr.type === "true" || expr.type === "false" || expr.type === "boolean") {
        typesFound.add(targetLang === "python" ? "bool" : "boolean");
      } else if (expr.type === "array" || expr.type === "list") {
        typesFound.add(targetLang === "python" ? "List[Any]" : "any[]");
      } else if (expr.type === "object" || expr.type === "dictionary") {
        typesFound.add(targetLang === "python" ? "Dict[str, Any]" : "Record<string, any>");
      } else if (expr.type === "comparison_operator" || expr.type === "binary_expression" || expr.type === "binary_operator") {
        if (expr.type === "comparison_operator" || txt.includes("===") || txt.includes("==") || txt.includes(">") || txt.includes("<")) {
          typesFound.add(targetLang === "python" ? "bool" : "boolean");
        } else if (txt.includes("+") && /['"`]/.test(txt)) {
          typesFound.add(targetLang === "python" ? "str" : "string");
        } else {
          typesFound.add(targetLang === "python" ? "int" : "number");
        }
      } else {
        typesFound.add(targetLang === "python" ? "Any" : "any");
      }
    }

    if (typesFound.size > 0) {
      if (targetLang === "python") {
        const arr = Array.from(typesFound);
        baseType = arr.length === 1 ? arr[0] : `Union[${arr.join(", ")}]`;
      } else {
        baseType = Array.from(typesFound).join(" | ");
      }
    }
  }

  if (isAsync) {
    return targetLang === "python" ? baseType : `Promise<${baseType}>`;
  }
  return baseType;
}

/**
 * Formats inferred properties into a TypeScript interface definition
 */
function formatTypeScriptDefinition(
  typeName: string,
  properties: InferredProperty[],
  methods: Array<{ name: string; params: string[]; returnType: string }>
): string {
  const lines: string[] = [];
  lines.push(`export interface ${typeName} {`);

  for (const prop of properties) {
    const opt = prop.optional ? "?" : "";
    lines.push(`  /** Inferred from: ${prop.contextSnippet.replace(/\n/g, " ")} */`);
    lines.push(`  ${prop.name}${opt}: ${prop.type};`);
  }

  for (const m of methods) {
    lines.push(`  ${m.name}(${m.params.join(", ")}): ${m.returnType};`);
  }

  lines.push("}\n");
  return lines.join("\n");
}

/**
 * Formats inferred properties into Python TypedDict definition
 */
function formatPythonDefinition(
  typeName: string,
  properties: InferredProperty[],
  methods: Array<{ name: string; params: string[]; returnType: string }>
): string {
  const lines: string[] = [];
  lines.push(`class ${typeName}(TypedDict, total=False):`);

  if (properties.length === 0 && methods.length === 0) {
    lines.push("    pass\n");
    return lines.join("\n");
  }

  for (const prop of properties) {
    const optType = prop.optional ? `Optional[${prop.type}]` : prop.type;
    lines.push(`    # Inferred from: ${prop.contextSnippet.replace(/\n/g, " ")}`);
    lines.push(`    ${prop.name}: ${optType}`);
  }

  for (const m of methods) {
    lines.push(`    ${m.name}: Callable[..., ${m.returnType}]`);
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Main backfillTypes operation
 */
export async function backfillTypes(params: {
  filePath: string;
  projectRoot?: string;
  symbolName?: string;
  targetLanguage?: "typescript" | "python";
  content?: string;
  registry?: ParserRegistry;
}): Promise<ReadResult> {
  let tree: Tree | null = null;
  try {
    let content = params.content;

    if (!content) {
      if (!existsSync(params.filePath)) {
        return {
          success: false,
          error: `File does not exist: ${params.filePath}`,
        };
      }
      content = await fs.readFile(params.filePath, "utf-8");
    }

    const sourceCode: string = content;
    const ext = path.extname(params.filePath).toLowerCase();
    const targetLang = params.targetLanguage || (ext === ".py" ? "python" : "typescript");

    // Initialize Parser Registry
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
        error: `No AST parser registered for extension ${ext}`,
      };
    }

    tree = parser.parse(content);
    const rootNode = tree.rootNode;
    const inferences: FunctionTypeInference[] = [];
    const combinedDefs: string[] = [];

    // Traverse rootNode to find function definitions
    function inspectNode(node: Node) {
      let isFunction = false;
      let funcName = "";
      let paramsNode: Node | null = null;
      let isAsync = false;

      if (targetLang === "typescript") {
        if (node.type === "function_declaration" || node.type === "method_definition") {
          isFunction = true;
          funcName = node.childForFieldName("name")?.text || "anonymous";
          paramsNode = node.childForFieldName("parameters");
          isAsync = node.text.startsWith("async");
        } else if (node.type === "arrow_function" || node.type === "function_expression") {
          isFunction = true;
          paramsNode = node.childForFieldName("parameters");
          isAsync = node.text.startsWith("async");
          if (node.parent && node.parent.type === "variable_declarator") {
            funcName = node.parent.childForFieldName("name")?.text || "anonymous";
          } else {
            funcName = "anonymous";
          }
        }
      } else {
        if (node.type === "function_definition") {
          isFunction = true;
          funcName = node.childForFieldName("name")?.text || "anonymous";
          paramsNode = node.childForFieldName("parameters");
          isAsync = node.text.startsWith("async");
        }
      }

      if (isFunction && paramsNode) {
        if (params.symbolName && funcName !== params.symbolName) {
          // Skip if user requested a specific symbol
        } else {
          const inferredParams: InferredParameterType[] = [];
          const paramSigParts: string[] = [];

          for (let pIdx = 0; pIdx < paramsNode.namedChildCount; pIdx++) {
            const pChild = paramsNode.namedChild(pIdx);
            if (!pChild) continue;

            let pName = "";
            let hasDefault = false;

            if (pChild.type === "identifier" || pChild.type === "required_parameter") {
              pName = pChild.type === "required_parameter" ? pChild.namedChild(0)?.text || pChild.text : pChild.text;
            } else if (pChild.type === "assignment_pattern" || pChild.type === "default_parameter") {
              pName = pChild.childForFieldName("left")?.text || pChild.namedChild(0)?.text || "";
              hasDefault = true;
            } else if (pChild.type === "rest_pattern") {
              continue; // Rest param handled separately
            }

            // Exclude python self / cls
            if (targetLang === "python" && (pName === "self" || pName === "cls")) {
              paramSigParts.push(pName);
              continue;
            }

            if (pName) {
              const typeName = `${toPascalCase(funcName)}${toPascalCase(pName)}`;
              const { properties, methods } = analyzeParameterUsage(node, pName, targetLang, sourceCode);
              const propArray = Array.from(properties.values());
              const methodArray = Array.from(methods.entries()).map(([k, v]) => ({ name: k, ...v }));

              let genDef = "";
              if (targetLang === "typescript") {
                genDef = formatTypeScriptDefinition(typeName, propArray, methodArray);
                paramSigParts.push(`${pName}${hasDefault ? "?" : ""}: ${typeName}`);
              } else {
                genDef = formatPythonDefinition(typeName, propArray, methodArray);
                paramSigParts.push(`${pName}: ${typeName}${hasDefault ? " = ..." : ""}`);
              }

              inferredParams.push({
                parameterName: pName,
                targetTypeName: typeName,
                properties: propArray,
                methods: methodArray,
                generatedInterface: genDef,
              });

              if (propArray.length > 0 || methodArray.length > 0) {
                combinedDefs.push(genDef);
              }
            }
          }

          const returnType = inferReturnType(node, targetLang, isAsync);

          let annotatedSig = "";
          if (targetLang === "typescript") {
            annotatedSig = `${isAsync ? "async " : ""}function ${funcName}(${paramSigParts.join(", ")}): ${returnType}`;
          } else {
            annotatedSig = `${isAsync ? "async " : ""}def ${funcName}(${paramSigParts.join(", ")}) -> ${returnType}:`;
          }

          inferences.push({
            functionName: funcName,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            parameters: inferredParams,
            inferredReturnType: returnType,
            annotatedSignature: annotatedSig,
          });
        }
      }

      // Recurse
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i);
        if (c) inspectNode(c);
      }
    }

    inspectNode(rootNode);

    const report: TypeInferenceReport = {
      filePath: params.filePath,
      targetLanguage: targetLang,
      functionsCount: inferences.length,
      inferences,
      combinedTypeDefinitions: combinedDefs.join("\n"),
    };

    return {
      success: true,
      content: JSON.stringify(report, null, 2),
    };
  } catch (error) {
    return {
      success: false,
      error: `Error executing backfill_types: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    // SRE Guardrail: Strict WASM Linear Memory Disposal
    try {
      tree?.delete();
    } catch {}
  }
}
