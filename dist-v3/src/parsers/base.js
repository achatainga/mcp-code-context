/**
 * Base Parser - v3.0.0
 * Abstract base for all language parsers
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
        return this.parser.parse(content, oldTree);
    }
    getName() {
        return this.languageName;
    }
}
//# sourceMappingURL=base.js.map