import fs from "node:fs";

const raw = fs.readFileSync("scripts/old-index.ts.txt");
// Handle UTF-16LE from git show on Windows
let text = raw.toString("utf8");
if (text.includes("\0")) {
  text = raw.toString("utf16le");
}

const lines = text.split(/\r?\n/);
const start = lines.findIndex((l) => l.includes("const TOOLS"));
const end = lines.findIndex((l, i) => i > start && l.trim() === "];");
if (start < 0 || end < 0) {
  console.error("TOOLS block not found", start, end);
  process.exit(1);
}

let tools = lines.slice(start, end + 1).join("\n").replace("const TOOLS", "export const TOOLS");

const sessionTools = `
  {
    name: "get_session_stats",
    description: "Get statistics for the current MCP client session",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "clear_session_cache",
    description: "Clear cache for current session only",
    inputSchema: {
      type: "object" as const,
      properties: { projectRoot: { type: "string", description: "Optional project root" } },
    },
  },
  {
    name: "list_pending_operations",
    description: "List pending operations for crash recovery",
    inputSchema: { type: "object" as const, properties: {} },
  },`;

tools = tools.replace("];", `${sessionTools}\n];`);

const writeOps = `export const WRITE_OPS = new Set([
  "write_file_surgical",
  "insert_symbol",
  "remove_symbol",
  "rename_symbol",
  "rollback_file",
]);`;

fs.writeFileSync(
  "src/tools/toolDefinitions.ts",
  `/** MCP tool schemas */\n\n${writeOps}\n\n${tools}\n`,
  "utf8"
);

console.log("OK", end - start + 1, "lines");
