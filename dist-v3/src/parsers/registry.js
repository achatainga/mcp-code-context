/**
 * Parser Registry - v3.0.0
 * Manages all language parsers
 */
import { TypeScriptParser } from "./typescript.js";
import { PythonParser } from "./python.js";
import { PHPParser } from "./php.js";
import { DartTreeSitterParser } from "./dartTreeSitter.js";
export class ParserRegistry {
    parsers = new Map();
    engine;
    extensionMap = new Map([
        [".ts", "typescript"],
        [".tsx", "typescript"],
        [".js", "typescript"],
        [".jsx", "typescript"],
        [".mts", "typescript"],
        [".mjs", "typescript"],
        [".py", "python"],
        [".pyi", "python"],
        [".php", "php"],
        [".dart", "dart"],
    ]);
    constructor(engine) {
        this.engine = engine;
    }
    async init() {
        // Load TypeScript
        await this.engine.loadLanguage("typescript");
        const tsLang = this.engine.getLanguage("typescript");
        if (!tsLang)
            throw new Error("Failed to load TypeScript language");
        const tsParser = new TypeScriptParser();
        await tsParser.init(this.engine.createParser(), tsLang);
        this.parsers.set("typescript", tsParser);
        // Load Python
        await this.engine.loadLanguage("python");
        const pyLang = this.engine.getLanguage("python");
        if (!pyLang)
            throw new Error("Failed to load Python language");
        const pyParser = new PythonParser();
        await pyParser.init(this.engine.createParser(), pyLang);
        this.parsers.set("python", pyParser);
        // Load PHP
        await this.engine.loadLanguage("php");
        const phpLang = this.engine.getLanguage("php");
        if (!phpLang)
            throw new Error("Failed to load PHP language");
        const phpParser = new PHPParser();
        await phpParser.init(this.engine.createParser(), phpLang);
        this.parsers.set("php", phpParser);
        // Load Dart (Tree-sitter WASM)
        await this.engine.loadLanguage("dart");
        const dartLang = this.engine.getLanguage("dart");
        if (!dartLang)
            throw new Error("Failed to load Dart language");
        const dartParser = new DartTreeSitterParser();
        await dartParser.init(this.engine.createParser(), dartLang);
        this.parsers.set("dart", dartParser);
        console.log("✅ Parsers loaded: TS/Python/PHP/Dart (WASM)");
    }
    getParser(fileExtension) {
        const language = this.extensionMap.get(fileExtension);
        return language ? this.parsers.get(language) : undefined;
    }
    getSupportedExtensions() {
        return Array.from(this.extensionMap.keys());
    }
}
//# sourceMappingURL=registry.js.map