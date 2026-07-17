/**
 * Rust Parser - v3.9.1
 * Tree-sitter based Rust parser
 */

import { Tree, Node } from "web-tree-sitter";
import { BaseParser, SymbolInfo } from "./base.js";

export class RustParser extends BaseParser {
  constructor() {
    super("rust");
  }

  extractSymbol(tree: Tree, symbolName: string, className?: string): string | null {
    const src = tree.rootNode.text;
    const symbols = this.findSymbols(tree);
    const target = symbols.find(s =>
      s.name === symbolName && (!className || s.className === className)
    );
    return target ? src.substring(target.startIndex, target.endIndex) : null;
  }

  findSymbols(tree: Tree): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];
    const cursor = tree.walk();
    const src = tree.rootNode.text;
    const offsetToLine = (offset: number) => src.substring(0, offset).split("\n").length;

    const visit = () => {
      const node = cursor.currentNode;

      if (node.type === "function_item" ||
          node.type === "struct_item" ||
          node.type === "enum_item" ||
          node.type === "trait_item" ||
          node.type === "impl_item" ||
          node.type === "type_item") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          const parentImpl = this.findParentImpl(node);
          symbols.push({
            name: nameNode.text,
            type: node.type,
            startIndex: node.startIndex,
            endIndex: node.endIndex,
            startLine: offsetToLine(node.startIndex),
            endLine: offsetToLine(node.endIndex),
            className: parentImpl,
          });
        }
      }

      if (cursor.gotoFirstChild()) {
        do { visit(); } while (cursor.gotoNextSibling());
        cursor.gotoParent();
      }
    };

    visit();
    return symbols;
  }

  // Returns the type name of the parent impl block (e.g. impl MyStruct)
  private findParentImpl(node: Node): string | undefined {
    let current = node.parent;
    while (current) {
      if (current.type === "impl_item") {
        const typeNode = current.childForFieldName("type");
        return typeNode?.text;
      }
      current = current.parent;
    }
    return undefined;
  }
}
