/**
 * Go Parser - v3.7.1
 * Tree-sitter based Go parser
 */

import { Tree, Node } from "web-tree-sitter";
import { BaseParser, SymbolInfo } from "./base.js";

export class GoParser extends BaseParser {
  constructor() {
    super("go");
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

      // func Name() / func (r Receiver) Name()
      if (node.type === "function_declaration" || node.type === "method_declaration") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          // For methods, extract receiver type as className
          let className: string | undefined;
          if (node.type === "method_declaration") {
            const receiver = node.childForFieldName("receiver");
            const paramDecl = receiver?.namedChild(0);
            const typeNode = paramDecl?.childForFieldName("type");
            className = typeNode?.text?.replace(/^\*/, ""); // strip pointer *
          }
          symbols.push({
            name: nameNode.text,
            type: node.type,
            startIndex: node.startIndex,
            endIndex: node.endIndex,
            startLine: offsetToLine(node.startIndex),
            endLine: offsetToLine(node.endIndex),
            className,
          });
        }
      }

      // type Name struct/interface
      if (node.type === "type_declaration") {
        const spec = node.namedChild(0);
        if (spec?.type === "type_spec") {
          const nameNode = spec.childForFieldName("name");
          if (nameNode) {
            symbols.push({
              name: nameNode.text,
              type: spec.childForFieldName("type")?.type ?? "type_spec",
              startIndex: node.startIndex,
              endIndex: node.endIndex,
              startLine: offsetToLine(node.startIndex),
              endLine: offsetToLine(node.endIndex),
            });
          }
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
}
