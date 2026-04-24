/**
 * Parser Registry - v3.0.0
 * Manages all language parsers
 */
import { TypeScriptParser } from "./typescript.js";
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
    ]);
    constructor(engine) {
        this.engine = engine;
    }
    async init() {
        // Load TypeScript language
        await this.engine.loadLanguage("typescript");
        const tsLang = this.engine.getLanguage("typescript");
        if (!tsLang)
            throw new Error("Failed to load TypeScript language");
        const tsParser = new TypeScriptParser();
        await tsParser.init(this.engine.createParser(), tsLang);
        this.parsers.set("typescript", tsParser);
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