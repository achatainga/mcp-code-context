/**
 * IndexManager Test Suite - v3.8.1
 */

import { IndexManager } from "../src/core/indexManager.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`✅ ${message}`);
    passed++;
  } else {
    console.error(`❌ ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log("🚀 Running IndexManager Test Suite\n");
  console.log("=".repeat(60));

  // Use a temp dir as projectRoot so each test run gets a fresh index
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-test-index-"));
  const projectRoot = path.join(tmpDir, "project");
  await fs.mkdir(projectRoot);

  const idx = new IndexManager(projectRoot);

  try {
    // ── 1. Empty index ──────────────────────────────────────────────────────
    console.log("\n🧪 Testing empty index...");
    const hasIndex = await idx.hasIndex();
    assert(!hasIndex, "Empty index returns false for hasIndex()");

    const emptySearch = await idx.searchSymbols("anything");
    assert(emptySearch.length === 0, "Empty index returns no symbols");

    const emptyDeps = await idx.getDependents("/some/file.ts");
    assert(emptyDeps.length === 0, "Empty index returns no dependents");

    // ── 2. Index a file ─────────────────────────────────────────────────────
    console.log("\n🧪 Testing indexFile...");
    const fileA = path.join(projectRoot, "a.ts");
    const hashA = "abc123";

    await idx.indexFile(fileA, hashA, [
      { name: "MyClass", type: "class_declaration", startIndex: 0, endIndex: 100, startLine: 1, endLine: 10 },
      { name: "myMethod", type: "method_definition", startIndex: 110, endIndex: 200, startLine: 3, endLine: 8, className: "MyClass" },
      { name: "helperFn", type: "function_declaration", startIndex: 210, endIndex: 300, startLine: 12, endLine: 18 },
    ], []);

    assert(await idx.hasIndex(), "hasIndex() returns true after indexing");

    const staleAfterIndex = await idx.isStale(fileA, hashA);
    assert(!staleAfterIndex, "isStale() returns false for same hash");

    const staleNewHash = await idx.isStale(fileA, "different-hash");
    assert(staleNewHash, "isStale() returns true for different hash");

    const staleUnknown = await idx.isStale("/unknown/file.ts", "any");
    assert(staleUnknown, "isStale() returns true for unknown file");

    // ── 3. Search symbols ───────────────────────────────────────────────────
    console.log("\n🧪 Testing searchSymbols...");

    const exactMatch = await idx.searchSymbols("MyClass");
    assert(exactMatch.length === 1, "Exact search finds MyClass");
    assert(exactMatch[0].name === "MyClass", "Exact search result name correct");
    assert(exactMatch[0].type === "class_declaration", "Exact search result type correct");
    assert(exactMatch[0].startLine === 1, "Exact search result startLine correct");

    const methodMatch = await idx.searchSymbols("myMethod");
    assert(methodMatch.length === 1, "Exact search finds myMethod");
    assert(methodMatch[0].className === "MyClass", "Method className correct");

    const noMatch = await idx.searchSymbols("nonExistent");
    assert(noMatch.length === 0, "Search returns empty for unknown symbol");

    // Fuzzy search
    const fuzzyMatch = await idx.searchSymbols("class", { fuzzy: true });
    assert(fuzzyMatch.length >= 1, "Fuzzy search finds symbols containing 'class'");

    const fuzzyHelper = await idx.searchSymbols("helper", { fuzzy: true });
    assert(fuzzyHelper.length === 1, "Fuzzy search finds helperFn");
    assert(fuzzyHelper[0].name === "helperFn", "Fuzzy search result name correct");

    // Type filter
    const typeFilter = await idx.searchSymbols("my", {
      fuzzy: true,
      types: ["method_definition"],
    });
    assert(typeFilter.length === 1, "Type filter returns only methods");
    assert(typeFilter[0].name === "myMethod", "Type filter result correct");

    // ── 4. Dependencies ─────────────────────────────────────────────────────
    console.log("\n🧪 Testing dependencies...");
    const fileB = path.join(projectRoot, "b.ts");
    const fileC = path.join(projectRoot, "c.ts");

    await idx.indexFile(fileB, "hashB", [
      { name: "BClass", type: "class_declaration", startIndex: 0, endIndex: 50, startLine: 1, endLine: 5 },
    ], [fileA]); // B imports A

    await idx.indexFile(fileC, "hashC", [
      { name: "CClass", type: "class_declaration", startIndex: 0, endIndex: 50, startLine: 1, endLine: 5 },
    ], [fileA, fileB]); // C imports A and B

    const dependentsOfA = await idx.getDependents(fileA);
    assert(dependentsOfA.length === 2, "A has 2 dependents (B and C)");
    assert(dependentsOfA.includes(fileB), "B is a dependent of A");
    assert(dependentsOfA.includes(fileC), "C is a dependent of A");

    const dependentsOfB = await idx.getDependents(fileB);
    assert(dependentsOfB.length === 1, "B has 1 dependent (C)");
    assert(dependentsOfB[0] === fileC, "C is a dependent of B");

    const depsOfC = await idx.getDependencies(fileC);
    assert(depsOfC.length === 2, "C has 2 dependencies (A and B)");

    const depsOfA = await idx.getDependencies(fileA);
    assert(depsOfA.length === 0, "A has no dependencies");

    // ── 5. Re-index (upsert) ────────────────────────────────────────────────
    console.log("\n🧪 Testing re-index (upsert)...");
    const newHashA = "newHash456";
    await idx.indexFile(fileA, newHashA, [
      { name: "MyClassRenamed", type: "class_declaration", startIndex: 0, endIndex: 100, startLine: 1, endLine: 10 },
    ], []);

    const afterReindex = await idx.searchSymbols("MyClassRenamed");
    assert(afterReindex.length === 1, "After re-index, new symbol exists");
    assert(afterReindex[0].name === "MyClassRenamed", "Re-indexed symbol name correct");

    const oldSymbol = await idx.searchSymbols("helperFn");
    assert(oldSymbol.length === 0, "Old symbols removed after re-index");

    const notStale = await idx.isStale(fileA, newHashA);
    assert(!notStale, "isStale() false after re-index with new hash");

    // ── 6. Remove file ──────────────────────────────────────────────────────
    console.log("\n🧪 Testing removeFile...");
    await idx.removeFile(fileB);

    const afterRemove = await idx.searchSymbols("BClass");
    assert(afterRemove.length === 0, "BClass removed after removeFile");

    const dependentsAfterRemove = await idx.getDependents(fileA);
    // C still depends on A, B is gone
    assert(dependentsAfterRemove.length === 1, "Only C remains as dependent of A after B removed");

    // ── 7. Stats ────────────────────────────────────────────────────────────
    console.log("\n🧪 Testing getStats...");
    const stats = await idx.getStats();
    assert(stats.filesIndexed >= 2, `Stats: filesIndexed >= 2 (got ${stats.filesIndexed})`);
    assert(stats.symbolsIndexed >= 2, `Stats: symbolsIndexed >= 2 (got ${stats.symbolsIndexed})`);
    assert(stats.lastIndexedAt !== null, "Stats: lastIndexedAt is set");

    // ── 8. Clear ────────────────────────────────────────────────────────────
    console.log("\n🧪 Testing clear...");
    await idx.clear();
    assert(!(await idx.hasIndex()), "hasIndex() false after clear");
    const statsAfterClear = await idx.getStats();
    assert(statsAfterClear.filesIndexed === 0, "Stats: 0 files after clear");

  } finally {
    await idx.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("\n📊 TEST SUMMARY\n");
  console.log(`Total Tests: ${passed + failed}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Success Rate: ${(((passed) / (passed + failed)) * 100).toFixed(1)}%`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log("\n🎉 ALL INDEX MANAGER TESTS PASSED!");
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
