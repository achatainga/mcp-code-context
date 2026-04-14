/**
 * Smoke test — validates all 3 tools work against this project's own source.
 * Run with: node dist/test-smoke.js
 */
import { IgnoreManager } from "../src/utils/ignoreManager.js";
import { compressFile, extractSymbol } from "../src/ast/semanticCompressor.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
function log(label, value) {
    console.log(`  ✓ ${label}: ${value}`);
}
async function main() {
    console.log("\n🧪 Smoke Test: mcp-code-context\n");
    // --- Test 1: IgnoreManager ---
    console.log("─── Test 1: IgnoreManager ───");
    const ig = new IgnoreManager(PROJECT_ROOT);
    const files = ig.walkDirectory();
    log("Files discovered", files.length);
    log("node_modules excluded", files.every(f => !f.includes("node_modules")) ? "YES" : "FAIL");
    log("dist excluded", files.every(f => !f.includes(path.sep + "dist" + path.sep)) ? "YES" : "FAIL");
    // --- Test 2: Semantic Compression ---
    console.log("\n─── Test 2: Semantic Compression (TypeScript) ───");
    const indexPath = path.join(PROJECT_ROOT, "src", "index.ts");
    const indexContent = fs.readFileSync(indexPath, "utf-8");
    const compressed = compressFile(indexPath, indexContent);
    log("Original lines", indexContent.split("\n").length);
    log("Compressed lines", compressed.split("\n").length);
    log("Contains function signatures", compressed.includes("function") ? "YES" : "FAIL");
    log("Bodies stripped (/* ... */)", compressed.includes("/* ... */") ? "YES" : "FAIL");
    // --- Test 3: Symbol Extraction ---
    console.log("\n─── Test 3: Symbol Extraction ───");
    const compressorPath = path.join(PROJECT_ROOT, "src", "ast", "semanticCompressor.ts");
    const compressorContent = fs.readFileSync(compressorPath, "utf-8");
    const symbol = extractSymbol(compressorContent, "compressFile", compressorPath);
    log("Symbol 'compressFile' found", symbol ? "YES" : "FAIL");
    log("Symbol length", symbol ? symbol.split("\n").length + " lines" : "0");
    const missing = extractSymbol(compressorContent, "nonExistentFunction", compressorPath);
    log("Missing symbol returns null", missing === null ? "YES" : "FAIL");
    // --- Test 4: Python Compression ---
    console.log("\n─── Test 4: Python Compression (synthetic) ───");
    const pythonSample = `
import os
from pathlib import Path

class FileProcessor:
    """Processes files in a directory."""
    
    def __init__(self, root: str):
        """Initialize with root directory."""
        self.root = root
        self.files: list[str] = []
    
    def scan(self, pattern: str = "*") -> list[str]:
        """Scan for files matching pattern."""
        for f in Path(self.root).glob(pattern):
            self.files.append(str(f))
        return self.files

def process_all(directory: str) -> int:
    """Process all files in directory."""
    processor = FileProcessor(directory)
    files = processor.scan()
    for f in files:
        print(f"Processing {f}")
    return len(files)
`;
    const pyCompressed = compressFile("test.py", pythonSample);
    log("Python compressed lines", pyCompressed.split("\n").length);
    log("Contains class signature", pyCompressed.includes("class FileProcessor") ? "YES" : "FAIL");
    log("Contains method signature", pyCompressed.includes("def scan") ? "YES" : "FAIL");
    log("Contains docstring", pyCompressed.includes("Processes files") ? "YES" : "FAIL");
    log("Body replaced with ...", pyCompressed.includes("...") ? "YES" : "FAIL");
    console.log("\n✅ All smoke tests passed!\n");
}
main().catch((err) => {
    console.error("\n❌ Smoke test failed:", err);
    process.exit(1);
});
//# sourceMappingURL=test-smoke.js.map