/**
 * v3.0 Smoke Test
 */
import { CodeContextEngine } from "../src/core/engine.js";
import { ParserRegistry } from "../src/parsers/registry.js";
import { SecurityValidator } from "../src/core/validator.js";
import * as path from "node:path";
async function test() {
    console.log("🧪 Testing v3.0 Engine...");
    // Test 1: Engine initialization
    const engine = new CodeContextEngine();
    await engine.init();
    console.log("✅ Engine initialized");
    // Test 2: Parser registry
    const registry = new ParserRegistry(engine);
    await registry.init();
    console.log("✅ Parser registry loaded");
    // Test 3: Security validator
    const validator = new SecurityValidator(process.cwd());
    const testFile = path.join(process.cwd(), "package.json");
    const validation = await validator.validateFilePath(testFile);
    if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.error}`);
    }
    console.log("✅ Security validator working");
    // Test 4: Parse TypeScript
    const tsParser = registry.getParser(".ts");
    if (!tsParser) {
        throw new Error("TypeScript parser not found");
    }
    const testCode = `
function hello(name: string): string {
  return "Hello, " + name;
}

class Greeter {
  greet(name: string) {
    return hello(name);
  }
}
`;
    const tree = tsParser.parse(testCode);
    const symbols = tsParser.findSymbols(tree);
    console.log(`✅ Parsed TypeScript: ${symbols.length} symbols found`);
    console.log(`   Symbols: ${symbols.map(s => s.name).join(", ")}`);
    // Test 5: Extract symbol
    const extracted = tsParser.extractSymbol(tree, "hello");
    if (!extracted) {
        throw new Error("Failed to extract 'hello' function");
    }
    console.log("✅ Symbol extraction working");
    console.log("\n🎉 All v3.0 tests passed!");
}
test().catch((error) => {
    console.error("❌ Test failed:", error);
    process.exit(1);
});
//# sourceMappingURL=test-v3-smoke.js.map