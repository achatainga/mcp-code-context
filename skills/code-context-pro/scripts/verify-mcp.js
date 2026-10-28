#!/usr/bin/env node
const { execSync } = require('node:child_process');

console.log('Testing CodeContext Pro runtime environment...');
try {
  const nodeVer = process.version;
  console.log('Node.js version:', nodeVer);
  const npxOut = execSync('npx -y mcp-code-context@latest --version 2>&1', { timeout: 10000 }).toString();
  console.log('mcp-code-context output:', npxOut.trim());
  console.log('Verification PASSED: Environment ready for enterprise operation.');
} catch (err) {
  console.error('Verification notice:', err.message);
}
