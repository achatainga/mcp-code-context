/**
 * Base Parser - v3.4.0
 * Abstract base for all language parsers
 * IMPROVEMENT: replaceSymbol moved here using AST indices (eliminates indexOf fragility)
 */
export class BaseParser {
    parser;
    language;
    languageName;
    constructor(languageName) {
        this.languageName = languageName;
    }
    async init(parser, language) {
        this.parser = parser;
        this.language = language;
        this.parser.setLanguage(language);
    }
    parse(content, oldTree) {
        const tree = this.parser.parse(content, oldTree);
        if (!tree)
            throw new Error(`${this.languageName} parsing failed`);
        return tree;
    }
    /**
     * Replace a symbol using AST startIndex/endIndex (no indexOf fragility)
     * Concrete implementation — subclasses inherit this.
     */
    replaceSymbol(content, tree, symbolName, newContent, className) {
        // Find symbol via AST
        const symbols = this.findSymbols(tree);
        const target = symbols.find(s => s.name === symbolName && (!className || s.className === className));
        if (!target) {
            throw new Error(`Symbol "${symbolName}" not found`);
        }
        // Use AST indices for precise replacement (no indexOf false-match)
        return content.substring(0, target.startIndex) +
            newContent +
            content.substring(target.endIndex);
    }
    getName() {
        return this.languageName;
    }
}
//# sourceMappingURL=base.js.map