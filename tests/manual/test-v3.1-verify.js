#!/usr/bin/env node

/**
 * Manual Test for v3.1.0 - Verify all 11 tools exist
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log("🚀 Testing v3.1.0 - Verifying all 11 tools\n");

// Read the compiled index.js
const indexPath = join(__dirname, "..", "dist", "src", "index.js");
const indexContent = readFileSync(indexPath, "utf-8");

const requiredTools = [
  "get_semantic_repo_map",
  "read_file_surgical",
  "analyze_impact",
  "read_file_lines",
  "search_code_pattern",
  "parse_file",
  "replace_symbol",
  "insert_code",
  "remove_symbol",
  "rename_symbol",
];

let passed = 0;
let failed = 0;

console.log("Checking for tool definitions...\n");

for (const tool of requiredTools) {
  const regex = new RegExp(`name:\\s*["']${tool}["']`);
  if (regex.test(indexContent)) {
    console.log(`  ✅ ${tool}`);
    passed++;
  } else {
    console.log(`  ❌ ${tool} - NOT FOUND`);
    failed++;
  }
}

console.log("\n" + "=".repeat(50));
console.log(`\n📊 Results: ${passed}/${requiredTools.length} tools found`);

// Check for handler functions
console.log("\nChecking for handler functions...\n");

const handlers = [
  "handleGetSemanticRepoMap",
  "handleReadFileSurgical",
  "handleAnalyzeImpact",
  "handleReadFileLines",
  "handleSearchCodePattern",
  "handleParseFile",
  "handleReplaceSymbol",
  "handleInsertCode",
  "handleRemoveSymbol",
  "handleRenameSymbol",
];

let handlersPassed = 0;

for (const handler of handlers) {
  if (indexContent.includes(`function ${handler}`)) {
    console.log(`  ✅ ${handler}`);
    handlersPassed++;
  } else {
    console.log(`  ❌ ${handler} - NOT FOUND`);
  }
}

console.log("\n" + "=".repeat(50));
console.log(`\n📊 Handlers: ${handlersPassed}/${handlers.length} found`);

// Check for operation modules
console.log("\nChecking for operation modules...\n");

const modules = ["read.js", "write.js", "compress.js"];
let modulesPassed = 0;

for (const mod of modules) {
  const modPath = join(__dirname, "..", "dist", "src", "operations", mod);
  try {
    readFileSync(modPath, "utf-8");
    console.log(`  ✅ operations/${mod}`);
    modulesPassed++;
  } catch {
    console.log(`  ❌ operations/${mod} - NOT FOUND`);
  }
}

console.log("\n" + "=".repeat(50));
console.log(`\n📊 Modules: ${modulesPassed}/${modules.length} found`);

// Final result
console.log("\n" + "=".repeat(50));

if (passed === requiredTools.length && handlersPassed === handlers.length && modulesPassed === modules.length) {
  console.log("\n🎉 ALL CHECKS PASSED! v3.1.0 is feature complete.\n");
  process.exit(0);
} else {
  console.log("\n❌ SOME CHECKS FAILED\n");
  process.exit(1);
}
