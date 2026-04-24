/**
 * Base Parser - v3.0.0
 * Abstract base for all language parsers
 */

import { Parser, Tree, Language, Node } from "web-tree-sitter";

export interface ParseResult {
  tree: Tree;
  language: string;
}

export interface SymbolInfo {
  name: string;
  type: string;
  startIndex: number;
  endIndex: number;
  className?: string;
}

export abstract class BaseParser {
  protected parser!: Parser;
  protected language!: Language;
  protected languageName: string;

  constructor(languageName: string) {
    this.languageName = languageName;
  }

  async init(parser: Parser, language: Language): Promise<void> {
    this.parser = parser;
    this.language = language;
    this.parser.setLanguage(language);
  }
 
  parse(content: string, oldTree?: Tree): Tree {
    const tree = this.parser.parse(content, oldTree);
    if (!tree) throw new Error(`${this.languageName} parsing failed`);
    return tree;
  }
 
  abstract extractSymbol(
    tree: Tree,
    symbolName: string,
    className?: string
  ): string | null;
 
  abstract replaceSymbol(
    content: string,
    tree: Tree,
    symbolName: string,
    newContent: string,
    className?: string
  ): string;
 
  abstract findSymbols(tree: Tree): SymbolInfo[];

  getName(): string {
    return this.languageName;
  }
}
