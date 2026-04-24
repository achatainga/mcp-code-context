/**
 * TypeScript Parser - v3.0.0
 * Tree-sitter based TS/JS parser
 */
import { BaseParser } from "./base.js";
export class TypeScriptParser extends BaseParser {
    constructor() {
        super("typescript");
    }
    extractSymbol(tree, symbolName, className) {
        const query = this.language.query(`
      (function_declaration name: (identifier) @name) @func
      (class_declaration name: (type_identifier) @name) @class
      (method_definition name: (property_identifier) @name) @method
      (interface_declaration name: (type_identifier) @name) @interface
      (type_alias_declaration name: (type_identifier) @name) @type
    `);
        const matches = query.matches(tree.rootNode);
        for (const match of matches) {
            const nameCapture = match.captures.find((c) => c.name === "name");
            if (!nameCapture || nameCapture.node.text !== symbolName)
                continue;
            if (className) {
                const classNode = this.findParentClass(nameCapture.node);
                if (!classNode || classNode.childForFieldName("name")?.text !== className) {
                    continue;
                }
            }
            const symbolCapture = match.captures.find((c) => ["func", "class", "method", "interface", "type"].includes(c.name));
            if (symbolCapture) {
                return tree.rootNode.text.substring(symbolCapture.node.startIndex, symbolCapture.node.endIndex);
            }
        }
        return null;
    }
    replaceSymbol(content, tree, symbolName, newContent, className) {
        const extracted = this.extractSymbol(tree, symbolName, className);
        if (!extracted) {
            throw new Error(`Symbol "${symbolName}" not found`);
        }
        const index = content.indexOf(extracted);
        if (index === -1) {
            throw new Error("Could not locate symbol in content");
        }
        return content.substring(0, index) + newContent + content.substring(index + extracted.length);
    }
    findSymbols(tree) {
        const query = this.language.query(`
      (function_declaration name: (identifier) @name) @func
      (class_declaration name: (type_identifier) @name) @class
      (method_definition name: (property_identifier) @name) @method
    `);
        const matches = query.matches(tree.rootNode);
        const symbols = [];
        for (const match of matches) {
            const nameCapture = match.captures.find((c) => c.name === "name");
            const typeCapture = match.captures.find((c) => ["func", "class", "method"].includes(c.name));
            if (nameCapture && typeCapture) {
                symbols.push({
                    name: nameCapture.node.text,
                    type: typeCapture.name,
                    startIndex: typeCapture.node.startIndex,
                    endIndex: typeCapture.node.endIndex,
                });
            }
        }
        return symbols;
    }
    findParentClass(node) {
        let current = node.parent;
        while (current) {
            if (current.type === "class_declaration")
                return current;
            current = current.parent;
        }
        return null;
    }
}
//# sourceMappingURL=typescript.js.map