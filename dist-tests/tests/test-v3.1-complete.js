/**
 * Comprehensive Tests for v3.1.0 - All 11 Tools
 */
import { CodeContextEngine } from "../src/core/engine.js";
import { ParserRegistry } from "../src/parsers/registry.js";
import { extractSymbol, readLines, searchPattern, analyzeImpact } from "../src/operations/read.js";
import { compressRepository } from "../src/operations/compress.js";
import { replaceSymbol, insertCode, removeSymbol, renameSymbol } from "../src/operations/write.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
let engine;
let registry;
let testDir;
async function setup() {
    console.log("🔧 Setting up test environment...");
    engine = new CodeContextEngine();
    await engine.init();
    registry = new ParserRegistry(engine);
    await registry.init();
    // Create test directory
    testDir = path.join(process.cwd(), "test-temp");
    await fs.mkdir(testDir, { recursive: true });
    // Create test files
    await fs.writeFile(path.join(testDir, "test.ts"), `export class TestClass {
  constructor() {}
  
  testMethod() {
    return "test";
  }
}

export function testFunction() {
  return 42;
}
`);
    await fs.writeFile(path.join(testDir, "test.py"), `class TestClass:
    def test_method(self):
        return "test"

def test_function():
    return 42
`);
    console.log("✅ Test environment ready\n");
}
async function cleanup() {
    console.log("\n🧹 Cleaning up...");
    await fs.rm(testDir, { recursive: true, force: true });
    console.log("✅ Cleanup complete");
}
async function testGetSemanticRepoMap() {
    console.log("📋 Testing get_semantic_repo_map...");
    const result = await compressRepository({
        directoryPath: testDir,
        format: "xml",
        registry,
    });
    if (!result.success) {
        throw new Error(`get_semantic_repo_map failed: ${result.error}`);
    }
    if (!result.content?.includes("<repository>")) {
        throw new Error("Invalid XML output");
    }
    if (!result.content.includes("TestClass")) {
        throw new Error("Missing TestClass in output");
    }
    console.log("  ✅ XML format works");
    const mdResult = await compressRepository({
        directoryPath: testDir,
        format: "markdown",
        registry,
    });
    if (!mdResult.success || !mdResult.content?.includes("# Repository Map")) {
        throw new Error("Markdown format failed");
    }
    console.log("  ✅ Markdown format works");
    console.log("✅ get_semantic_repo_map PASSED\n");
}
async function testReadFileSurgical() {
    console.log("📖 Testing read_file_surgical...");
    const tsPath = path.join(testDir, "test.ts");
    const parser = registry.getParser(".ts");
    if (!parser)
        throw new Error("No TS parser");
    const result = await extractSymbol({
        filePath: tsPath,
        projectRoot: testDir,
        symbolName: "testFunction",
        parser,
    });
    if (!result.success) {
        throw new Error(`extractSymbol failed: ${result.error}`);
    }
    if (!result.content?.includes("testFunction")) {
        throw new Error("Symbol not extracted");
    }
    console.log("  ✅ Symbol extraction works");
    console.log("✅ read_file_surgical PASSED\n");
}
async function testAnalyzeImpact() {
    console.log("🔍 Testing analyze_impact...");
    const tsPath = path.join(testDir, "test.ts");
    const result = await analyzeImpact({
        filePath: tsPath,
        rootDir: testDir,
    });
    if (!result.success) {
        throw new Error(`analyzeImpact failed: ${result.error}`);
    }
    const data = JSON.parse(result.content);
    if (!data.file || !Array.isArray(data.dependents)) {
        throw new Error("Invalid impact analysis output");
    }
    console.log("  ✅ Dependency analysis works");
    console.log("✅ analyze_impact PASSED\n");
}
async function testReadFileLines() {
    console.log("📄 Testing read_file_lines...");
    const tsPath = path.join(testDir, "test.ts");
    // Test line range
    const result1 = await readLines({
        filePath: tsPath,
        startLine: 1,
        endLine: 3,
    });
    if (!result1.success) {
        throw new Error(`readLines failed: ${result1.error}`);
    }
    if (!result1.content?.includes("TestClass")) {
        throw new Error("Line range extraction failed");
    }
    console.log("  ✅ Line range works");
    // Test pattern search
    const result2 = await readLines({
        filePath: tsPath,
        aroundPattern: "testMethod",
        contextLines: 2,
    });
    if (!result2.success || !result2.content?.includes("testMethod")) {
        throw new Error("Pattern search failed");
    }
    console.log("  ✅ Pattern search works");
    console.log("✅ read_file_lines PASSED\n");
}
async function testSearchCodePattern() {
    console.log("🔎 Testing search_code_pattern...");
    const result = await searchPattern({
        rootDir: testDir,
        pattern: "testFunction",
        maxResults: 10,
    });
    if (!result.success) {
        throw new Error(`searchPattern failed: ${result.error}`);
    }
    const data = JSON.parse(result.content);
    if (!Array.isArray(data) || data.length === 0) {
        throw new Error("No search results found");
    }
    console.log("  ✅ Pattern search works");
    console.log("✅ search_code_pattern PASSED\n");
}
async function testReplaceSymbol() {
    console.log("✏️ Testing replace_symbol...");
    const tsPath = path.join(testDir, "test.ts");
    const parser = registry.getParser(".ts");
    if (!parser)
        throw new Error("No TS parser");
    const result = await replaceSymbol({
        filePath: tsPath,
        projectRoot: testDir,
        symbolName: "testFunction",
        newContent: `export function testFunction() {\n  return 100;\n}`,
        parser,
    });
    if (!result.success) {
        throw new Error(`replaceSymbol failed: ${result.error}`);
    }
    if (!result.newContent?.includes("return 100")) {
        throw new Error("Symbol not replaced");
    }
    console.log("  ✅ Symbol replacement works");
    console.log("✅ replace_symbol PASSED\n");
}
async function testInsertCode() {
    console.log("➕ Testing insert_code...");
    const tsPath = path.join(testDir, "test.ts");
    const parser = registry.getParser(".ts");
    if (!parser)
        throw new Error("No TS parser");
    const result = await insertCode({
        filePath: tsPath,
        projectRoot: testDir,
        code: `export function newFunction() {\n  return "new";\n}`,
        parser,
    });
    if (!result.success) {
        throw new Error(`insertCode failed: ${result.error}`);
    }
    if (!result.newContent?.includes("newFunction")) {
        throw new Error("Code not inserted");
    }
    console.log("  ✅ Code insertion works");
    console.log("✅ insert_code PASSED\n");
}
async function testRemoveSymbol() {
    console.log("🗑️ Testing remove_symbol...");
    const tsPath = path.join(testDir, "test.ts");
    const parser = registry.getParser(".ts");
    if (!parser)
        throw new Error("No TS parser");
    const result = await removeSymbol({
        filePath: tsPath,
        projectRoot: testDir,
        symbolName: "testFunction",
        parser,
    });
    if (!result.success) {
        throw new Error(`removeSymbol failed: ${result.error}`);
    }
    if (result.newContent?.includes("function testFunction")) {
        throw new Error("Symbol not removed");
    }
    console.log("  ✅ Symbol removal works");
    console.log("✅ remove_symbol PASSED\n");
}
async function testRenameSymbol() {
    console.log("🔄 Testing rename_symbol...");
    const tsPath = path.join(testDir, "test.ts");
    const parser = registry.getParser(".ts");
    if (!parser)
        throw new Error("No TS parser");
    const result = await renameSymbol({
        filePath: tsPath,
        projectRoot: testDir,
        oldName: "TestClass",
        newName: "RenamedClass",
        rootDir: testDir,
        parser,
    });
    if (!result.success) {
        throw new Error(`renameSymbol failed: ${result.error}`);
    }
    if (!result.newContent?.includes("RenamedClass")) {
        throw new Error("Symbol not renamed");
    }
    console.log("  ✅ Symbol rename works");
    console.log("✅ rename_symbol PASSED\n");
}
async function runAllTests() {
    console.log("🚀 Starting v3.1.0 Comprehensive Tests\n");
    console.log("=".repeat(50) + "\n");
    let passed = 0;
    let failed = 0;
    try {
        await setup();
        const tests = [
            testGetSemanticRepoMap,
            testReadFileSurgical,
            testAnalyzeImpact,
            testReadFileLines,
            testSearchCodePattern,
            testReplaceSymbol,
            testInsertCode,
            testRemoveSymbol,
            testRenameSymbol,
        ];
        for (const test of tests) {
            try {
                await test();
                passed++;
            }
            catch (error) {
                failed++;
                console.error(`❌ ${test.name} FAILED:`, error);
            }
        }
        await cleanup();
        console.log("\n" + "=".repeat(50));
        console.log(`\n📊 Test Results: ${passed}/${tests.length} passed`);
        if (failed === 0) {
            console.log("\n🎉 ALL TESTS PASSED!\n");
            process.exit(0);
        }
        else {
            console.log(`\n❌ ${failed} tests failed\n`);
            process.exit(1);
        }
    }
    catch (error) {
        console.error("\n💥 Test suite failed:", error);
        process.exit(1);
    }
}
runAllTests();
