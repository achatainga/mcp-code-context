/**
 * Write Operations - v3.0.0
 * Surgical code modifications with Tree-sitter
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { SecurityValidator } from "../core/validator.js";
/**
 * Replace a symbol with new content
 */
export async function replaceSymbol(options) {
    const { filePath, projectRoot, symbolName, newContent, className, parser } = options;
    // Validate
    const validator = new SecurityValidator(projectRoot);
    const validation = await validator.validateFilePath(filePath);
    if (!validation.valid) {
        return { success: false, error: validation.error };
    }
    try {
        // Read file
        const content = await fs.readFile(validation.resolvedPath, "utf-8");
        // Parse
        const tree = parser.parse(content);
        // Replace
        const result = parser.replaceSymbol(content, tree, symbolName, newContent, className);
        // Generate diff
        const diff = generateDiff(content, result);
        return {
            success: true,
            newContent: result,
            diff,
        };
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
/**
 * Insert code at a specific location
 */
export async function insertCode(options) {
    const { filePath, projectRoot, code, anchorSymbol, position = "after", className, parser } = options;
    const validator = new SecurityValidator(projectRoot);
    const validation = await validator.validateFilePath(filePath);
    if (!validation.valid) {
        return { success: false, error: validation.error };
    }
    try {
        const content = await fs.readFile(validation.resolvedPath, "utf-8");
        const tree = parser.parse(content);
        let insertIndex;
        if (!anchorSymbol) {
            // Insert at end
            insertIndex = content.length;
        }
        else {
            // Find anchor
            const extracted = parser.extractSymbol(tree, anchorSymbol, className);
            if (!extracted) {
                return { success: false, error: `Anchor symbol "${anchorSymbol}" not found` };
            }
            const anchorIndex = content.indexOf(extracted);
            if (anchorIndex === -1) {
                return { success: false, error: "Could not locate anchor in content" };
            }
            switch (position) {
                case "before":
                    insertIndex = anchorIndex;
                    break;
                case "after":
                    insertIndex = anchorIndex + extracted.length;
                    break;
                case "inside_start":
                    // Find first { after anchor
                    insertIndex = content.indexOf("{", anchorIndex) + 1;
                    break;
                case "inside_end":
                    // Find last } of anchor
                    insertIndex = anchorIndex + extracted.lastIndexOf("}");
                    break;
                default:
                    insertIndex = anchorIndex + extracted.length;
            }
        }
        const result = content.substring(0, insertIndex) + "\n" + code + "\n" + content.substring(insertIndex);
        const diff = generateDiff(content, result);
        return {
            success: true,
            newContent: result,
            diff,
        };
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
/**
 * Remove a symbol from file
 */
export async function removeSymbol(options) {
    const { filePath, projectRoot, symbolName, className, parser } = options;
    const validator = new SecurityValidator(projectRoot);
    const validation = await validator.validateFilePath(filePath);
    if (!validation.valid) {
        return { success: false, error: validation.error };
    }
    try {
        const content = await fs.readFile(validation.resolvedPath, "utf-8");
        const tree = parser.parse(content);
        const extracted = parser.extractSymbol(tree, symbolName, className);
        if (!extracted) {
            return { success: false, error: `Symbol "${symbolName}" not found` };
        }
        const index = content.indexOf(extracted);
        if (index === -1) {
            return { success: false, error: "Could not locate symbol in content" };
        }
        const result = content.substring(0, index) + content.substring(index + extracted.length);
        const diff = generateDiff(content, result);
        return {
            success: true,
            newContent: result,
            diff,
        };
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
/**
 * Write content to file (atomic)
 */
export async function renameSymbol(params) {
    try {
        // Step 1: Rename in definition file
        const content = await fs.readFile(params.filePath, "utf-8");
        const tree = params.parser.parse(content);
        const extracted = params.parser.extractSymbol(tree, content, params.oldName);
        if (!extracted) {
            return {
                success: false,
                error: `Symbol "${params.oldName}" not found in ${params.filePath}`,
            };
        }
        const newContent = content.replace(new RegExp(`\\b${params.oldName}\\b`, "g"), params.newName);
        // Step 2: Find dependent files
        const dependents = [];
        const targetFile = path.basename(params.filePath);
        async function walkDir(dir) {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (!["node_modules", "dist", "build", ".git"].includes(entry.name)) {
                        await walkDir(fullPath);
                    }
                }
                else if (entry.isFile()) {
                    const ext = path.extname(entry.name);
                    if ([".ts", ".js", ".py", ".php", ".dart"].includes(ext)) {
                        const fileContent = await fs.readFile(fullPath, "utf-8");
                        if (fileContent.includes(params.oldName)) {
                            dependents.push(fullPath);
                        }
                    }
                }
            }
        }
        await walkDir(params.rootDir);
        // Step 3: Rename in all dependent files
        for (const depFile of dependents) {
            const depContent = await fs.readFile(depFile, "utf-8");
            const depNewContent = depContent.replace(new RegExp(`\\b${params.oldName}\\b`, "g"), params.newName);
            await fs.writeFile(depFile, depNewContent, "utf-8");
        }
        // Step 4: Write definition file
        await fs.writeFile(params.filePath, newContent, "utf-8");
        return {
            success: true,
            newContent,
            diff: `Renamed in ${dependents.length + 1} files`,
        };
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
export async function writeFile(filePath, content) {
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, content, "utf-8");
    await fs.rename(tmpPath, filePath);
}
/**
 * Generate unified diff (simple line-by-line)
 */
function generateDiff(oldContent, newContent) {
    const oldLines = oldContent.split("\n");
    const newLines = newContent.split("\n");
    const diff = [];
    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
        const oldLine = oldLines[i];
        const newLine = newLines[i];
        if (oldLine === newLine) {
            diff.push(`  ${oldLine || ""}`);
        }
        else {
            if (oldLine !== undefined)
                diff.push(`- ${oldLine}`);
            if (newLine !== undefined)
                diff.push(`+ ${newLine}`);
        }
    }
    return diff.join("\n");
}
