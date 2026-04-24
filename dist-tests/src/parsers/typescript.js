/**
 * TypeScript Parser - v3.5.1
 * Tree-sitter based TS/JS parser
 * CLEANUP: replaceSymbol removed (inherited from BaseParser)
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
                node.type === "interface_declaration" ||
                node.type === "type_alias_declaration" ||
                node.type === "method_definition" ||
                node.type === "lexical_declaration" ||
                node.type === "variable_declaration" ||
                node.type === "export_statement") {
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
    findSymbols(tree) {
        const symbols = [];
        const cursor = tree.walk();
        const visit = () => {
            const node = cursor.currentNode;
            if (node.type === "function_declaration" ||
                node.type === "class_declaration" ||
                node.type === "interface_declaration" ||
                node.type === "type_alias_declaration" ||
                node.type === "method_definition") {
                const nameNode = node.childForFieldName("name");
                if (nameNode) {
                    const parentClass = this.findParentClass(node);
                    // If wrapped in export_statement, use parent indices so replaceSymbol
                    // includes the "export" keyword — otherwise replacement leaves it orphaned
                    const exportParent = node.parent?.type === "export_statement" ? node.parent : null;
                    symbols.push({
                        name: nameNode.text,
                        type: node.type,
                        startIndex: exportParent ? exportParent.startIndex : node.startIndex,
                        endIndex: exportParent ? exportParent.endIndex : node.endIndex,
                        className: parentClass?.childForFieldName("name")?.text,
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