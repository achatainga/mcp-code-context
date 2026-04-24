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
        const cursor = tree.walk();
        const search = () => {
            const node = cursor.currentNode;
            if (node.type === "function_declaration" ||
                node.type === "class_declaration" ||
                node.type === "method_definition") {
                const nameNode = node.childForFieldName("name");
                if (nameNode && nameNode.text === symbolName) {
                    if (className) {
                        const classNode = this.findParentClass(node);
                        if (!classNode || classNode.childForFieldName("name")?.text !== className) {
                            // Continue searching
                        }
                        else {
                            return tree.rootNode.text.substring(node.startIndex, node.endIndex);
                        }
                    }
                    else {
                        return tree.rootNode.text.substring(node.startIndex, node.endIndex);
                    }
                }
            }
            if (cursor.gotoFirstChild()) {
                do {
                    const result = search();
                    if (result)
                        return result;
                } while (cursor.gotoNextSibling());
                cursor.gotoParent();
            }
            return null;
        };
        return search();
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
        const symbols = [];
        const cursor = tree.walk();
        const visit = () => {
            const node = cursor.currentNode;
            if (node.type === "function_declaration" ||
                node.type === "class_declaration" ||
                node.type === "method_definition") {
                const nameNode = node.childForFieldName("name");
                if (nameNode) {
                    symbols.push({
                        name: nameNode.text,
                        type: node.type,
                        startIndex: node.startIndex,
                        endIndex: node.endIndex,
                    });
                }
            }
            if (cursor.gotoFirstChild()) {
                do {
                    visit();
                } while (cursor.gotoNextSibling());
                cursor.gotoParent();
            }
        };
        visit();
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