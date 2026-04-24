/**
 * v3.0 Write Operations Test
 */

import { CodeContextEngine } from "../src/core/engine.js";
import { ParserRegistry } from "../src/parsers/registry.js";
import { replaceSymbol, insertCode, removeSymbol, writeFile } from "../src/operations/write.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

async function test() {
  console.log("🧪 Testing v3.0 Write Operations...\n");

  const engine = new CodeContextEngine();
  await engine.init();
  const registry = new ParserRegistry(engine);
  await registry.init();

  const projectRoot = process.cwd();
  const testFile = path.join(projectRoot, "test-temp.ts");

  // Create test file
  const originalCode = `function hello(name: string): string {
  return "Hello, " + name;
}

class Greeter {
  greet(name: string) {
    return hello(name);
  }
}`;

  await fs.writeFile(testFile, originalCode, "utf-8");
  console.log("✅ Test file created\n");

  const parser = registry.getParser(".ts")!;

  // Test 1: Replace symbol
  console.log("Test 1: Replace symbol");
  const replaceResult = await replaceSymbol({
    filePath: testFile,
    projectRoot,
    symbolName: "hello",
    newContent: "function hello(name: string) { return `Hi, ${name}`; }",
    parser,
  });

  if (!replaceResult.success) throw new Error(`Replace failed: ${replaceResult.error}`);
  console.log("✅ Replace successful");
  console.log(replaceResult.diff);
  console.log();

  // Write result
  await writeFile(testFile, replaceResult.newContent!);

  // Test 2: Insert code
  console.log("Test 2: Insert code");
  const insertResult = await insertCode({
    filePath: testFile,
    projectRoot,
    code: "function goodbye() { return 'Bye!'; }",
    anchorSymbol: "hello",
    position: "after",
    parser,
  });

  if (!insertResult.success) throw new Error(`Insert failed: ${insertResult.error}`);
  console.log("✅ Insert successful");
  console.log();

  await writeFile(testFile, insertResult.newContent!);

  // Test 3: Remove symbol
  console.log("Test 3: Remove symbol");
  const removeResult = await removeSymbol({
    filePath: testFile,
    projectRoot,
    symbolName: "goodbye",
    parser,
  });

  if (!removeResult.success) throw new Error(`Remove failed: ${removeResult.error}`);
  console.log("✅ Remove successful");
  console.log();

  await writeFile(testFile, removeResult.newContent!);

  // Cleanup
  await fs.unlink(testFile);
  console.log("✅ Test file cleaned up\n");

  console.log("🎉 All write operations working perfectly!");
}

test().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
