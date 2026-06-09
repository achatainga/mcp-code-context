import fs from "node:fs";

const lines = fs.readFileSync("src/tools/handlers.ts", "utf8").split("\n");
// Remove trailing extra brace if present
while (lines.length && lines[lines.length - 1].trim() === "}") {
  const content = lines.join("\n");
  const delta = [...content].reduce((d, c) => (c === "{" ? d + 1 : c === "}" ? d - 1 : d), 0);
  if (delta >= 0) break;
  lines.pop();
}

const header = lines.slice(0, 16).join("\n") + "\n\n";

const readBody = [
  ...lines.slice(21, 168),
  "",
  ...lines.slice(483, 556),
].join("\n");

const writeBody = lines.slice(173, 355).join("\n");

const adminBody = [
  ...lines.slice(360, 466),
  "",
  ...lines.slice(468, 482),
  "",
  ...lines.slice(558, 574),
].join("\n");

fs.writeFileSync("src/tools/readHandlers.ts", header + readBody + "\n");
fs.writeFileSync("src/tools/writeHandlers.ts", header + writeBody + "\n");
fs.writeFileSync("src/tools/adminHandlers.ts", header + adminBody + "\n");

fs.writeFileSync(
  "src/tools/handlers.ts",
  `/** Tool handlers — barrel re-exports */
export * from "./readHandlers.js";
export * from "./writeHandlers.js";
export * from "./adminHandlers.js";
`
);

console.log("handlers split done");
