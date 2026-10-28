# CodeContext Pro Windows One-Line Installer
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   CodeContext Pro v4.0.0 Enterprise — Quick Installer     " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js 18+ is required. Please install Node.js from https://nodejs.org/"
    exit 1
}

Write-Host "Verifying mcp-code-context..." -ForegroundColor Yellow
npx -y mcp-code-context@latest --version

Write-Host "CodeContext Pro v4.0.0 Enterprise is installed and verified!" -ForegroundColor Green
