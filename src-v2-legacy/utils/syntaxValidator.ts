/**
 * syntaxValidator.ts — Syntax Validation for Write Operations
 * 
 * Validates syntax after surgical edits to prevent committing broken code.
 * Supports TypeScript, JavaScript, PHP, Dart (basic), Python (basic).
 */

import * as path from "node:path";
import * as ts from "typescript";

export interface SyntaxValidationResult {
  valid: boolean;
  error?: string;
  diagnostics?: string[];
}

/**
 * Validate syntax of modified content before writing to disk
 */
export async function validateSyntax(
  filePath: string,
  content: string
): Promise<SyntaxValidationResult> {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case ".ts":
    case ".tsx":
    case ".mts":
      return validateTypeScript(content, filePath);
    
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return validateJavaScript(content, filePath);
    
    case ".php":
    case ".phtml":
      return await validatePHP(content);
    
    case ".dart":
      return await validateDart(content);
    
    case ".py":
    case ".pyi":
      return await validatePython(content);
    
    default:
      // Unknown extension, skip validation
      return { valid: true };
  }
}

/**
 * Validate TypeScript syntax using ts compiler API
 */
function validateTypeScript(
  content: string,
  filePath: string
): SyntaxValidationResult {
  try {
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    // Check for parse errors
    const diagnostics = (sourceFile as any).parseDiagnostics || [];
    
    if (diagnostics.length > 0) {
      const errors = diagnostics.map((d: ts.Diagnostic) => {
        const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
        const line = sourceFile.getLineAndCharacterOfPosition(d.start || 0).line + 1;
        return `Line ${line}: ${message}`;
      });

      return {
        valid: false,
        error: `TypeScript syntax errors found`,
        diagnostics: errors,
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: `TypeScript parsing failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Validate JavaScript syntax using ts compiler API (JS mode)
 */
function validateJavaScript(
  content: string,
  filePath: string
): SyntaxValidationResult {
  try {
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS
    );

    const diagnostics = (sourceFile as any).parseDiagnostics || [];
    
    if (diagnostics.length > 0) {
      const errors = diagnostics.map((d: ts.Diagnostic) => {
        const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
        const line = sourceFile.getLineAndCharacterOfPosition(d.start || 0).line + 1;
        return `Line ${line}: ${message}`;
      });

      return {
        valid: false,
        error: `JavaScript syntax errors found`,
        diagnostics: errors,
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: `JavaScript parsing failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Validate PHP syntax using php-parser
 */
async function validatePHP(content: string): Promise<SyntaxValidationResult> {
  try {
    // Dynamic import for ESM compatibility
    const phpParserModule = await import("php-parser");
    const phpParser = phpParserModule.default || phpParserModule;
    
    const parser = new phpParser.Engine({
      parser: {
        extractDoc: false,
        suppressErrors: false,
      },
    });

    const ast = parser.parseCode(content, "test.php");
    
    if (!ast || ast.errors?.length > 0) {
      const errors = ast.errors?.map((e: any) => 
        `Line ${e.line}: ${e.message}`
      ) || ["Unknown PHP syntax error"];

      return {
        valid: false,
        error: "PHP syntax errors found",
        diagnostics: errors,
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: `PHP parsing failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Validate Dart syntax (basic check for balanced braces)
 */
async function validateDart(content: string): Promise<SyntaxValidationResult> {
  // Basic validation: check for balanced braces
  let braceCount = 0;
  let parenCount = 0;
  let bracketCount = 0;

  for (const char of content) {
    if (char === "{") braceCount++;
    if (char === "}") braceCount--;
    if (char === "(") parenCount++;
    if (char === ")") parenCount--;
    if (char === "[") bracketCount++;
    if (char === "]") bracketCount--;

    if (braceCount < 0 || parenCount < 0 || bracketCount < 0) {
      return {
        valid: false,
        error: "Dart syntax error: Unbalanced brackets",
      };
    }
  }

  if (braceCount !== 0) {
    return {
      valid: false,
      error: `Dart syntax error: Unbalanced braces (${braceCount > 0 ? "missing" : "extra"} closing brace)`,
    };
  }

  if (parenCount !== 0) {
    return {
      valid: false,
      error: `Dart syntax error: Unbalanced parentheses`,
    };
  }

  if (bracketCount !== 0) {
    return {
      valid: false,
      error: `Dart syntax error: Unbalanced brackets`,
    };
  }

  return { valid: true };
}

/**
 * Validate Python syntax (basic indentation check)
 */
async function validatePython(content: string): Promise<SyntaxValidationResult> {
  const lines = content.split("\n");
  let indentStack: number[] = [0];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Skip empty lines and comments
    if (line.trim() === "" || line.trim().startsWith("#")) {
      continue;
    }

    // Calculate indentation
    const indent = line.length - line.trimStart().length;

    // Check for mixed tabs/spaces (basic check)
    const hasTab = line.startsWith("\t");
    const hasSpace = line.startsWith(" ");
    
    if (hasTab && hasSpace) {
      return {
        valid: false,
        error: `Python syntax error: Mixed tabs and spaces on line ${i + 1}`,
      };
    }

    // Check indentation consistency
    const currentIndent = indentStack[indentStack.length - 1];
    
    if (indent > currentIndent) {
      // Indent increased
      indentStack.push(indent);
    } else if (indent < currentIndent) {
      // Indent decreased
      while (indentStack.length > 0 && indentStack[indentStack.length - 1] > indent) {
        indentStack.pop();
      }
      
      if (indentStack.length === 0 || indentStack[indentStack.length - 1] !== indent) {
        return {
          valid: false,
          error: `Python syntax error: Invalid indentation on line ${i + 1}`,
        };
      }
    }
  }

  return { valid: true };
}
