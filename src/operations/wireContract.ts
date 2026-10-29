import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadUnifiedVirtualSchema } from "../utils/virtualSchema.js";
import { modelToTable } from "../utils/railsSchema.js";

export interface ContractDiscrepancy {
  field: string;
  frontendType: string;
  backendType?: string;
  issue: "MISSING_IN_BACKEND" | "TYPE_MISMATCH" | "CASING_CONVENTION_DRIFT" | "NULLABILITY_MISMATCH";
  recommendation: string;
}

export interface WireContractResult {
  endpoint?: string;
  frontendContract: {
    file: string;
    interfaceName: string;
    fieldCount: number;
  };
  backendContract: {
    source: string;
    modelOrTable: string;
    fieldCount: number;
  };
  matched: boolean;
  compatibilityScore: string;
  discrepancies: ContractDiscrepancy[];
  syncedFields: Array<{ frontend: string; backend: string; type: string }>;
}

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`).replace(/^_/, "");
}

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, g) => g.toUpperCase());
}

function areTypesCompatible(tsType: string, dbType: string): boolean {
  const ts = tsType.toLowerCase().trim();
  const db = dbType.toLowerCase().trim();

  // Number / Numeric
  if (ts === "number" || ts === "bigint") {
    return db.includes("int") || db.includes("decimal") || db.includes("float") ||
           db.includes("numeric") || db.includes("double") || db.includes("serial");
  }

  // String / Text
  if (ts === "string") {
    return db.includes("char") || db.includes("text") || db.includes("string") ||
           db.includes("uuid") || db.includes("cuid") || db.includes("date") || db.includes("timestamp");
  }

  // Boolean
  if (ts === "boolean") {
    return db.includes("bool") || db.includes("tinyint");
  }

  // Date
  if (ts === "date" || ts.includes("datetime")) {
    return db.includes("date") || db.includes("timestamp") || db.includes("time");
  }

  // Any / Mixed
  if (ts === "any" || ts === "unknown" || db.includes("json")) {
    return true;
  }

  return false;
}

export async function validateWireContract(params: {
  frontendFile: string;
  backendFile?: string;
  endpoint?: string;
  projectRoot: string;
}): Promise<WireContractResult> {
  const feContent = await fs.readFile(params.frontendFile, "utf-8");

  // 1. Extract frontend TypeScript interface fields
  const interfaceRe = /(?:interface|type)\s+([A-Za-z0-9_]+)\s*(?:=\s*)?\{([\s\S]*?)\}/g;
  let feMatch: RegExpExecArray | null;
  const feFields: Record<string, string> = {};
  let interfaceName = "InferredInterface";

  while ((feMatch = interfaceRe.exec(feContent)) !== null) {
    interfaceName = feMatch[1];
    const body = feMatch[2];
    const fieldLines = body.split("\n");

    for (const line of fieldLines) {
      const clean = line.trim().replace(/[;,]$/, "");
      if (!clean || clean.startsWith("//") || clean.startsWith("/*")) continue;

      const fMatch = clean.match(/^([a-zA-Z0-9_]+)\??\s*:\s*(.+)$/);
      if (fMatch) {
        feFields[fMatch[1]] = fMatch[2].trim();
      }
    }
    if (Object.keys(feFields).length > 0) break;
  }

  // 2. Extract backend fields (from backendFile or project virtual schema)
  let backendFields: Record<string, string> = {};
  let backendSource = "Virtual Schema";
  let backendModel = "InferredModel";

  if (params.backendFile) {
    try {
      const beContent = await fs.readFile(params.backendFile, "utf-8");
      backendSource = path.relative(params.projectRoot, params.backendFile).replace(/\\/g, "/");

      // Match PHP typed property: public string $email; or protected ?int $age;
      const phpPropRe = /^\s*(?:(?:public|protected|private|var|readonly)\s+)*(?:([?a-zA-Z0-9_\\]+)\s+)?\$([a-zA-Z0-9_]+)\s*(?:=\s*[^;]+)?;/gm;
      let phpMatch: RegExpExecArray | null;
      while ((phpMatch = phpPropRe.exec(beContent)) !== null) {
        const pType = phpMatch[1] ? phpMatch[1].replace(/^\?/, "") : "mixed";
        const name = phpMatch[2];
        backendFields[name] = pType;
      }

      // Match TS/C#/Java properties: name: type or public Type name
      const tsPropRe = /^\s*(?:(?:public|protected|private|readonly)\s+)*([a-zA-Z0-9_]+)\s*:\s*([a-zA-Z0-9_<>]+)/gm;
      let tsMatch: RegExpExecArray | null;
      while ((tsMatch = tsPropRe.exec(beContent)) !== null) {
        const name = tsMatch[1];
        if (!["function", "class", "constructor", "return"].includes(name)) {
          backendFields[name] = tsMatch[2];
        }
      }
    } catch {
      // fallback
    }
  }

  // If no direct backend file or fields, query virtual schema
  if (Object.keys(backendFields).length === 0) {
    const ext = params.backendFile ? path.extname(params.backendFile) : undefined;
    const unified = await loadUnifiedVirtualSchema(params.projectRoot, ext).catch(() => null);

    if (unified && unified.schema) {
      backendSource = `${unified.framework} Virtual Schema`;
      // Match by interfaceName -> table
      const expectedTable = modelToTable(interfaceName.replace(/(Response|DTO|Type|Model|Schema)$/i, ""));
      const tableData = unified.schema[expectedTable] || Object.values(unified.schema)[0];
      if (tableData) {
        backendModel = expectedTable;
        backendFields = { ...tableData };
      }
    }
  }

  // 3. Compare contracts
  const discrepancies: ContractDiscrepancy[] = [];
  const syncedFields: Array<{ frontend: string; backend: string; type: string }> = [];

  const feEntries = Object.entries(feFields);
  for (const [feName, feType] of feEntries) {
    // Direct match
    if (backendFields[feName]) {
      const beType = backendFields[feName];
      if (areTypesCompatible(feType, beType)) {
        syncedFields.push({ frontend: feName, backend: feName, type: feType });
      } else {
        discrepancies.push({
          field: feName,
          frontendType: feType,
          backendType: beType,
          issue: "TYPE_MISMATCH",
          recommendation: `Align TypeScript type '${feType}' with database column type '${beType}'`,
        });
      }
      continue;
    }

    // Snake case match (e.g. camelCase frontend vs snake_case DB)
    const snake = toSnakeCase(feName);
    if (backendFields[snake]) {
      const beType = backendFields[snake];
      discrepancies.push({
        field: feName,
        frontendType: feType,
        backendType: beType,
        issue: "CASING_CONVENTION_DRIFT",
        recommendation: `Frontend uses camelCase '${feName}' while backend column is snake_case '${snake}'. Ensure serializer or API gateway performs camelCase transformation.`,
      });
      syncedFields.push({ frontend: feName, backend: snake, type: feType });
      continue;
    }

    // Camel case match (if DB column is camelCase and FE is snake)
    const camel = toCamelCase(feName);
    if (backendFields[camel]) {
      const beType = backendFields[camel];
      discrepancies.push({
        field: feName,
        frontendType: feType,
        backendType: beType,
        issue: "CASING_CONVENTION_DRIFT",
        recommendation: `Frontend uses snake_case '${feName}' while backend is camelCase '${camel}'.`,
      });
      syncedFields.push({ frontend: feName, backend: camel, type: feType });
      continue;
    }

    // Missing field
    discrepancies.push({
      field: feName,
      frontendType: feType,
      issue: "MISSING_IN_BACKEND",
      recommendation: `Field '${feName}' is defined in frontend interface '${interfaceName}' but does not exist in backend model '${backendModel}'.`,
    });
  }

  const totalFe = feEntries.length;
  const errorCount = discrepancies.filter(d => d.issue === "MISSING_IN_BACKEND" || d.issue === "TYPE_MISMATCH").length;
  const score = totalFe > 0 ? Math.max(0, Math.round(((totalFe - errorCount) / totalFe) * 100)) : 100;

  return {
    endpoint: params.endpoint,
    frontendContract: {
      file: path.relative(params.projectRoot, params.frontendFile).replace(/\\/g, "/"),
      interfaceName,
      fieldCount: totalFe,
    },
    backendContract: {
      source: backendSource,
      modelOrTable: backendModel,
      fieldCount: Object.keys(backendFields).length,
    },
    matched: discrepancies.length === 0,
    compatibilityScore: `${score}%`,
    discrepancies,
    syncedFields,
  };
}
