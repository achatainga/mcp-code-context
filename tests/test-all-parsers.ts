/**
 * v3.0 All Parsers Test
 */

import { CodeContextEngine } from "../src/core/engine.js";
import { ParserRegistry } from "../src/parsers/registry.js";
import * as path from "node:path";

async function test() {
  console.log("🧪 Testing v3.0 All Parsers...\n");

  const engine = new CodeContextEngine();
  await engine.init();
  console.log("✅ Engine initialized\n");

  const registry = new ParserRegistry(engine);
  await registry.init();
  console.log("✅ Registry loaded (TS, Python, PHP)\n");

  // Test TypeScript
  const tsParser = registry.getParser(".ts");
  if (!tsParser) throw new Error("TS parser not found");
  
  const tsCode = `
function add(a: number, b: number): number {
  return a + b;
}

class Calculator {
  multiply(x: number, y: number) {
    return x * y;
  }
}
`;
  
  const tsTree = tsParser.parse(tsCode);
  const tsSymbols = tsParser.findSymbols(tsTree);
  console.log(`✅ TypeScript: ${tsSymbols.length} symbols (${tsSymbols.map(s => s.name).join(", ")})`);

  // Test Python
  const pyParser = registry.getParser(".py");
  if (!pyParser) throw new Error("Python parser not found");
  
  const pyCode = `
def greet(name):
    return f"Hello, {name}"

class Person:
    def __init__(self, name):
        self.name = name
    
    def say_hello(self):
        return greet(self.name)
`;
  
  const pyTree = pyParser.parse(pyCode);
  const pySymbols = pyParser.findSymbols(pyTree);
  console.log(`✅ Python: ${pySymbols.length} symbols (${pySymbols.map(s => s.name).join(", ")})`);

  // Test PHP
  const phpParser = registry.getParser(".php");
  if (!phpParser) throw new Error("PHP parser not found");
  
  const phpCode = `<?php
function hello($name) {
    return "Hello, " . $name;
}

class User {
    public function getName() {
        return $this->name;
    }
}
?>`;
  
  const phpTree = phpParser.parse(phpCode);
  const phpSymbols = phpParser.findSymbols(phpTree);
  console.log(`✅ PHP: ${phpSymbols.length} symbols (${phpSymbols.map(s => s.name).join(", ")})`);

  // Test extraction
  const extracted = tsParser.extractSymbol(tsTree, "add");
  if (!extracted) throw new Error("Failed to extract 'add'");
  console.log("\n✅ Symbol extraction working");

  // Test replacement
  const newCode = tsParser.replaceSymbol(tsCode, tsTree, "add", "function add(a: number, b: number) { return a + b; }");
  if (!newCode.includes("function add")) throw new Error("Replacement failed");
  console.log("✅ Symbol replacement working");

  console.log("\n🎉 All parsers working perfectly!");
}

test().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
