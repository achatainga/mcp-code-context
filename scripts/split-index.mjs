import fs from "node:fs";

const lines = fs.readFileSync("src/core/indexManager.ts", "utf8").split("\n");
const header = lines.slice(0, 215).join("\n");
const queries = lines.slice(215, 319).join("\n");
const footer = lines.slice(319).join("\n");

const queryFile = `/**
 * Index query operations (search, dependents)
 */

import type { Database } from "sql.js";
import type { IndexedSymbol } from "./indexManager.js";

export async function searchSymbolsInDb(
  db: Database,
  query: string,
  options: { fuzzy?: boolean; types?: string[]; maxResults?: number } = {}
): Promise<IndexedSymbol[]> {
${queries.replace(/async searchSymbols\([\s\S]*?\): Promise<IndexedSymbol\[\]> \{[\s\S]*?await this\.initPromise;[\s\S]*?if \(!this\.db\) return \[\];[\s\S]*?const \{ fuzzy/g, "").replace(/this\.db/g, "db").replace(/^\s*\/\*\*[\s\S]*?Search symbols[\s\S]*?\*\/\s*/m, "  const { fuzzy")}

`;

// Simpler: extract getDependents and searchSymbols to separate file as exported functions
console.log("skip complex index split");
