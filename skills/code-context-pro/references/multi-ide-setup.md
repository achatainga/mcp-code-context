# CodeContext Pro — Universal Multi-IDE Setup Guide

CodeContext Pro is 100% platform-agnostic and runs identically on Windows, macOS, and Linux without native C++ compilation (`node-gyp`).

---

## 1. CLAUDE CODE CLI & CLAUDE DESKTOP

### Claude Code CLI
Run in your terminal:
```bash
claude mcp add code-context -- npx -y mcp-code-context@latest
```

### Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "code-context": {
      "command": "npx",
      "args": ["-y", "mcp-code-context@latest"]
    }
  }
}
```

---

## 2. CURSOR & WINDSURF

CodeContext Pro supports modern **Streamable HTTP** over SSE.

### Option A: Local Process (stdio)
In Cursor / Windsurf MCP settings:
- **Type**: `command`
- **Command**: `npx -y mcp-code-context@latest`

### Option B: Background Daemon (HTTP / SSE)
Start the background server:
```bash
npx -y mcp-code-context@latest --http --port=3000
```
In Cursor / Windsurf settings:
- **Type**: `sse`
- **URL**: `http://127.0.0.1:3000/sse`

---

## 3. VS CODE (ROO CODE / CLINE / COPILOT)

In your MCP settings (`cline_mcp_settings.json` or Roo Code settings):
```json
{
  "mcpServers": {
    "code-context": {
      "command": "node",
      "args": ["C:/code/mcp-code-context/dist/src/index.js"],
      "disabled": false,
      "autoApprove": [
        "get_semantic_repo_map",
        "read_file_surgical",
        "search_symbols",
        "explain_symbol",
        "analyze_impact",
        "get_impacted_tests",
        "get_call_hierarchy"
      ]
    }
  }
}
```

---

## 4. JETBRAINS (JUNIE / CONTINUE PLUGIN)

In `~/.continue/config.json`:
```json
{
  "mcpServers": [
    {
      "name": "code-context",
      "command": "npx",
      "args": ["-y", "mcp-code-context@latest"]
    }
  ]
}
```

---

## 5. GOOGLE ANTIGRAVITY

In `~/.gemini/antigravity/mcp_config.json`:
```json
{
  "mcpServers": {
    "mcp-code-context": {
      "command": "node",
      "args": ["C:/code/mcp-code-context/dist/src/index.js"]
    }
  }
}
```
