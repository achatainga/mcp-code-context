import fs from "node:fs";

function lineCount(p) {
  return fs.readFileSync(p, "utf8").split("\n").length;
}

// 1. Split toolDefinitions at rollback_file
{
  const src = fs.readFileSync("src/tools/toolDefinitions.ts", "utf8");
  const marker = 'name: "rollback_file"';
  const idx = src.indexOf(marker);
  const before = src.lastIndexOf("{", idx);
  const partA = src.slice(0, before).trimEnd().replace(/export const TOOLS = \[/, "export const TOOLS_A = [");
  const partB =
    "export const TOOLS_B = [\n  {\n    " +
    src.slice(src.lastIndexOf("{", idx)).trimEnd();
  const tail = partB.endsWith("];") ? partB : partB;
  const writeOps = src.split("export const TOOLS")[0].trim();
  fs.writeFileSync(
    "src/tools/toolDefinitions.ts",
    `${writeOps}\n\n${partA}\n];\n\n${partB}\n\nexport const TOOLS = [...TOOLS_A, ...TOOLS_B];\n`
  );
}

// 2. Trim safeRegex comments
{
  let s = fs.readFileSync("src/utils/safeRegex.ts", "utf8");
  s = s.replace(/^\/\*\*[\s\S]*?\*\/\n\n/, "");
  fs.writeFileSync("src/utils/safeRegex.ts", s);
}

// 3. Split indexManager queries (lines 219-391)
{
  const lines = fs.readFileSync("src/core/indexManager.ts", "utf8").split("\n");
  const cut = lines.findIndex((l) => l.includes("async searchSymbols"));
  const queryLines = lines.slice(cut, lines.findIndex((l) => l.includes("async clear(): Promise")));
  const queryBody = queryLines
    .join("\n")
    .replace(/async searchSymbols\(/g, "export async function searchSymbolsQuery(db: NonNullable<IndexManager[\"db\"] extends infer D ? D : never>, ")
    .replace(/await this\.initPromise;\s*\n\s*if \(!this\.db\) return \[\];/g, "if (!db) return [];")
    .replace(/this\.db/g, "db");

  // Simpler: cut file at searchSymbols and move to second file as continuation - too complex

  const keep = lines.slice(0, cut).join("\n");
  const moved = lines.slice(cut).join("\n");
  fs.writeFileSync(
    "src/core/indexManager.ts",
    keep +
      `\n  async searchSymbols(...args: Parameters<IndexManager["searchSymbols"]>) {
    await this.initPromise;
    const { searchSymbolsQuery } = await import("./indexManagerQueries.js");
    return searchSymbolsQuery(this.db!, ...args);
  }\n}\n`
  );
  // Skip broken query extraction - manual fix needed
}

console.log("split partial done");
console.log("toolDefinitions", lineCount("src/tools/toolDefinitions.ts"));
console.log("safeRegex", lineCount("src/utils/safeRegex.ts"));
