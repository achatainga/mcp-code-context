import * as ts from "typescript";
import * as path from "node:path";

export async function checkSymbolUsage(filePath: string, content: string, symbolName: string): Promise<boolean> {
  const ext = path.extname(filePath).toLowerCase();

  if ([".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"].includes(ext)) {
    return checkTSSymbolUsage(content, symbolName);
  }

  if ([".php", ".phtml"].includes(ext)) {
    return await checkPHPSymbolUsage(content, symbolName);
  }

  const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(?<=^|[^a-zA-Z0-9_$])(${escaped})(?=[^a-zA-Z0-9_$]|$)`);
  return regex.test(content);
}

function checkTSSymbolUsage(content: string, symbolName: string): boolean {
  try {
    const sourceFile = ts.createSourceFile("temp.ts", content, ts.ScriptTarget.Latest, true);
    let found = false;

    function visit(node: ts.Node) {
      if (ts.isIdentifier(node) && node.text === symbolName) {
        found = true;
      }
      if (!found) ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return found;
  } catch {
    return false;
  }
}

async function checkPHPSymbolUsage(content: string, symbolName: string): Promise<boolean> {
  try {
    const phpParserModule = await import("php-parser");
    const phpParser = phpParserModule.default || phpParserModule;
    const parser = new phpParser.Engine({});
    const ast = parser.parseCode(content, "temp.php");

    let found = false;
    function visit(node: any): void {
      if (node?.kind === "identifier" && node.name === symbolName) found = true;
      if (!found && node?.children) {
        for (const child of node.children) visit(child);
      }
    }

    visit(ast);
    return found;
  } catch {
    return false;
  }
}
