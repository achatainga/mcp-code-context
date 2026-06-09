import fs from "node:fs";

// Split toolDefinitions.ts TOOLS array in half
const src = fs.readFileSync("src/tools/toolDefinitions.ts", "utf8");
const lines = src.split("\n");
const toolsStart = lines.findIndex((l) => l.includes("export const TOOLS"));
const toolsEnd = lines.findIndex((l, i) => i > toolsStart && l.trim() === "];");
const toolsLines = lines.slice(toolsStart + 1, toolsEnd);
const mid = Math.floor(toolsLines.length / 2);

const partA = toolsLines.slice(0, mid).join("\n");
const partB = toolsLines.slice(mid).join("\n");

const writeOps = lines.slice(0, toolsStart).join("\n");

fs.writeFileSync(
  "src/tools/toolDefinitions.ts",
  `${writeOps}
export const TOOLS_PART_A = [
${partA}
];

export const TOOLS_PART_B = [
${partB}
];

export const TOOLS = [...TOOLS_PART_A, ...TOOLS_PART_B];
`
);

console.log("toolDefinitions split", toolsLines.length, "tools");
