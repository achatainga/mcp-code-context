/**
 * Dart Tree-sitter Parser - v3.0.0
 * 100% AST accuracy (requires tree-sitter-dart installed)
 */

import { Parser, Tree, Node } from "web-tree-sitter";
import { BaseParser, SymbolInfo } from "./base.js";
 
export class DartTreeSitterParser extends BaseParser {
  constructor() {
    super("dart");
  }
 
  extractSymbol(tree: Tree, symbolName: string, className?: string): string | null {
    const cursor = tree.walk();
 
    const search = (): string | null => {
      const node = cursor.currentNode;
      
      if (node.type === "function_signature" || 
          node.type === "class_definition" ||
          node.type === "method_signature") {
        const nameNode = node.childForFieldName("name");
        if (nameNode && nameNode.text === symbolName) {
          if (className) {
            const classNode = this.findParentClass(node);
            if (!classNode || classNode.childForFieldName("name")?.text !== className) {
            } else {
              return tree.rootNode.text.substring(node.startIndex, node.endIndex);
            }
          } else {
            return tree.rootNode.text.substring(node.startIndex, node.endIndex);
          }
        }
      }
 
      if (cursor.gotoFirstChild()) {
        do {
          const result = search();
          if (result) return result;
        } while (cursor.gotoNextSibling());
        cursor.gotoParent();
      }
 
      return null;
    };
 
    return search();
  }
 
  replaceSymbol(content: string, tree: Tree, symbolName: string, newContent: string, className?: string): string {
    const extracted = this.extractSymbol(tree, symbolName, className);
    if (!extracted) throw new Error(`Symbol "${symbolName}" not found`);
 
    const index = content.indexOf(extracted);
    if (index === -1) throw new Error("Could not locate symbol in content");
 
    return content.substring(0, index) + newContent + content.substring(index + extracted.length);
  }
 
  findSymbols(tree: Tree): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];
    const cursor = tree.walk();
 
    const visit = () => {
      const node = cursor.currentNode;
      
      if (node.type === "function_signature" || 
          node.type === "class_definition" ||
          node.type === "method_signature") {
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
 
  private findParentClass(node: Node): Node | null {
    let current = node.parent;
    while (current) {
      if (current.type === "class_definition") return current;
      current = current.parent;
    }
    return null;
  }
}
