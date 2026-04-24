/**
 * Python Parser - v3.5.2
 * CLEANUP: replaceSymbol removed (inherited from BaseParser)
 */
import { BaseParser } from "./base.js";
export class PythonParser extends BaseParser {
    constructor() {
        super("python");
    }
    extractSymbol(tree, symbolName, className) {
        const cursor = tree.walk();
        const search = () => {
            const node = cursor.currentNode;
            if (node.type === "function_definition" || node.type === "class_definition") {
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
            if (node.type === "function_definition" || node.type === "class_definition") {
                const nameNode = node.childForFieldName("name");
                if (nameNode) {
                    const parentClass = this.findParentClass(node);
                    symbols.push({
                        name: nameNode.text,
                        type: node.type,
                        startIndex: node.startIndex,
                        endIndex: node.endIndex,
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
            if (current.type === "class_definition")
                return current;
            current = current.parent;
        }
        return null;
    }
}
//# sourceMappingURL=python.js.map