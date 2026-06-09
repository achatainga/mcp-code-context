import fs from "node:fs";

const src = fs.readFileSync("src/tools/toolDefinitions.ts", "utf8");
const writeOps = src.split("export const TOOLS")[0].trim();
const toolsMatch = src.match(/export const TOOLS = \[([\s\S]*)\];/);
if (!toolsMatch) {
  console.error("TOOLS not found");
  process.exit(1);
}

const toolsContent = toolsMatch[1];
const splitAt = toolsContent.indexOf('name: "rollback_file"');
const lastBrace = toolsContent.lastIndexOf("{", splitAt);
const partA = toolsContent.slice(0, lastBrace).trimEnd();
const partB = toolsContent.slice(lastBrace).trimEnd();

fs.writeFileSync(
  "src/tools/toolDefinitions.ts",
  `${writeOps}

export const CORE_TOOLS = [
${partA}
];

export const ADMIN_TOOLS = [
${partB}
];

export const TOOLS = [...CORE_TOOLS, ...ADMIN_TOOLS];
`
);

console.log("split toolDefinitions OK");
