import fs from "node:fs";

const lines = fs.readFileSync("src/operations/read.ts", "utf8").split("\n");

const header = `/**
 * Read core — extractSymbol and readLines
 */

import * as fs from "node:fs/promises";
import * as crypto from "node:crypto";
import { BaseParser } from "../parsers/base.js";
import { safeRegexFindFirst } from "../utils/safeRegex.js";
import { validateRegexPattern } from "../utils/regexValidator.js";
import { CacheManager } from "../core/cacheManager.js";

export interface ReadResult {
  success: boolean;
  content?: string;
  symbols?: unknown[];
  error?: string;
}

async function getFileHash(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, "utf-8");
  return crypto.createHash("md5").update(content).digest("hex");
}

`;

const readCoreBody = lines.slice(35, 199).join("\n");
fs.writeFileSync("src/operations/readCore.ts", header + readCoreBody + "\n");

const searchHeader = `/**
 * Search pattern operation
 */

import * as fs from "node:fs/promises";
import { EXCLUDE_DIRS, SUPPORTED_EXTENSIONS, MAX_FILES_SEARCH, OPERATION_TIMEOUT_MS } from "../utils/constants.js";
import { safeRegexMultiFileBatchTest } from "../utils/safeRegex.js";
import { validateRegexPattern } from "../utils/regexValidator.js";
import { walkDir } from "../utils/fileWalker.js";
import { fuzzySearch } from "../utils/fuzzySearch.js";
import { searchWithNativeTool } from "../utils/searchTools.js";
import type { ReadResult } from "./readCore.js";

const DEFAULT_MAX_RESULTS = 10;
const SCAN_TIMEOUT_BASE_MS = 1000;
const SCAN_TIMEOUT_PER_FILE_MS = 10;

`;

const searchBody = lines.slice(203, 326).join("\n");
fs.writeFileSync("src/operations/searchOperation.ts", searchHeader + searchBody + "\n");

const impactHeader = `/**
 * Impact analysis operation
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { EXCLUDE_DIRS, SUPPORTED_EXTENSIONS } from "../utils/constants.js";
import { walkDir } from "../utils/fileWalker.js";
import { IndexManager } from "../core/indexManager.js";
import type { ReadResult } from "./readCore.js";

`;

const impactBody = lines.slice(330, 385).join("\n");
fs.writeFileSync("src/operations/impactAnalysis.ts", impactHeader + impactBody + "\n");

const symbolHeader = `/**
 * Symbol query operations — search, explain, batch read
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { EXCLUDE_DIRS, SUPPORTED_EXTENSIONS } from "../utils/constants.js";
import { walkDir } from "../utils/fileWalker.js";
import { IndexManager } from "../core/indexManager.js";
import { fuzzySearch } from "../utils/fuzzySearch.js";
import { BaseParser } from "../parsers/base.js";
import { extractSymbol, type ReadResult } from "./readCore.js";

`;

const symbolBody = lines.slice(389, 616).join("\n");
fs.writeFileSync("src/operations/symbolQuery.ts", symbolHeader + symbolBody + "\n");

fs.writeFileSync(
  "src/operations/read.ts",
  `/** Read operations — barrel exports */
export type { ReadResult } from "./readCore.js";
export { extractSymbol, readLines } from "./readCore.js";
export { searchPattern } from "./searchOperation.js";
export { analyzeImpact } from "./impactAnalysis.js";
export { searchSymbols, explainSymbol, batchRead } from "./symbolQuery.js";
`
);

console.log("read.ts split complete");
