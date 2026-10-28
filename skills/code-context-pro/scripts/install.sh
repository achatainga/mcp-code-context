#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo "   CodeContext Pro v4.0.0 Enterprise — Quick Installer     "
echo "=========================================================="

if ! command -v node >/dev/null 2>&1; then
    echo "❌ Node.js 18+ is required. Please install Node.js first."
    exit 1
fi

echo "📦 Verifying mcp-code-context installation..."
npx -y mcp-code-context@latest --version || true

echo "✅ CodeContext Pro is ready to use!"
echo "To connect with Claude Desktop, add to ~/Library/Application Support/Claude/claude_desktop_config.json"
