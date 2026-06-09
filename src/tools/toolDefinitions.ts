/** MCP tool schemas — barrel */

export const WRITE_OPS = new Set([
  "write_file_surgical",
  "insert_symbol",
  "remove_symbol",
  "rename_symbol",
  "rollback_file",
]);

import { CORE_TOOLS } from "./toolDefinitionsCore.js";
import { ADMIN_TOOLS } from "./toolDefinitionsAdmin.js";

export const TOOLS = [...CORE_TOOLS, ...ADMIN_TOOLS];
