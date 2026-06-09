/** Admin MCP tool schemas */

export const ADMIN_TOOLS = [
{
    name: "rollback_file",
    description: "Revert a file to its backup state",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "Absolute path to file" },
        projectRoot: { type: "string", description: "Project root (REQUIRED)" },
      },
      required: ["filePath", "projectRoot"],
    },
  },
  {
    name: "clean_backups",
    description: "Remove all backup files for a project",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root directory" },
      },
      required: ["projectRoot"],
    },
  },
  {
    name: "get_server_stats",
    description: "Get server telemetry, audit statistics, and health metrics",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_cache_stats",
    description: "Get cache statistics (entries, size, hit rate)",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root directory" },
      },
      required: ["projectRoot"],
    },
  },
  {
    name: "clear_cache",
    description: "Clear all cached parse results for a project",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root directory" },
      },
      required: ["projectRoot"],
    },
  },
  {
    name: "configure_file_watcher",
    description: "Start/stop file watcher for auto-cache invalidation",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root directory" },
        action: { type: "string", enum: ["start", "stop"], description: "Action to perform" },
        debounceMs: { type: "number", description: "Debounce delay in ms (default: 500)" },
      },
      required: ["projectRoot", "action"],
    },
  },
  {
    name: "get_file_watcher_status",
    description: "Get file watcher status for a project",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root directory" },
      },
      required: ["projectRoot"],
    },
  },

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
  },
];
