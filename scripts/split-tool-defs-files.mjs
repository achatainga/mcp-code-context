import fs from "node:fs";

const src = fs.readFileSync("src/tools/toolDefinitions.ts", "utf8");
const writeOps = src.match(/export const WRITE_OPS[\s\S]*?\);/)[0];

const coreMatch = src.match(/export const CORE_TOOLS = \[([\s\S]*?)\];/);
const adminMatch = src.match(/export const ADMIN_TOOLS = \[([\s\S]*?)\];/);

fs.writeFileSync(
  "src/tools/toolDefinitionsCore.ts",
  `/** Core MCP tool schemas (read + write) */\n\nexport const CORE_TOOLS = [${coreMatch[1]}];\n`
);
fs.writeFileSync(
  "src/tools/toolDefinitionsAdmin.ts",
  `/** Admin MCP tool schemas */\n\nexport const ADMIN_TOOLS = [${adminMatch[1]}];\n`
);
fs.writeFileSync(
  "src/tools/toolDefinitions.ts",
  `/** MCP tool schemas — barrel */\n\n${writeOps}\n\nimport { CORE_TOOLS } from "./toolDefinitionsCore.js";\nimport { ADMIN_TOOLS } from "./toolDefinitionsAdmin.js";\n\nexport const TOOLS = [...CORE_TOOLS, ...ADMIN_TOOLS];\n`
);

console.log("tool defs split to 3 files");
