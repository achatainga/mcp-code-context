# Deployment Instructions for v2.1.3

## ✅ Completed Steps
1. ✅ Code fixes implemented and tested
2. ✅ Version bumped to 2.1.3 in package.json
3. ✅ CHANGELOG.md updated
4. ✅ TROUBLESHOOTING.md updated
5. ✅ llms.txt updated
6. ✅ Test suite created and passing (11/11 tests)
7. ✅ Git commit created with semantic message
8. ✅ Git tag v2.1.3 created with release notes
9. ✅ Pushed to GitHub (main branch + tag)

## 🚀 Next Steps (Manual)

### 1. Publish to npm
You need to be logged in to npm. Run:

```bash
cd C:\code\antigravity-mcp-context

# Login to npm (if not already)
npm login

# Publish the package
npm publish

# Verify publication
npm view mcp-code-context@2.1.3
```

### 2. Create GitHub Release
Go to: https://github.com/achatainga/mcp-code-context/releases/new

- **Tag**: Select `v2.1.3` (already pushed)
- **Title**: `v2.1.3 - Windows CRLF & Parameter Brace Fixes`
- **Description**: Copy content from `RELEASE_NOTES_v2.1.3.md`
- **Attach files**: None needed (npm package is the artifact)
- Click **Publish release**

### 3. Verify Installation
Test that users can install the new version:

```bash
# Global install
npm install -g mcp-code-context@2.1.3

# Verify version
npx mcp-code-context --version  # Should show 2.1.3

# Test with MCP client (Claude Desktop, Amazon Q, etc.)
# Update config to use @2.1.3 and restart client
```

### 4. Announce (Optional)
Consider announcing on:
- GitHub Discussions
- Twitter/X
- Reddit (r/LocalLLaMA, r/ClaudeAI)
- Discord communities

## 📋 Verification Checklist

Before announcing:
- [ ] npm package published successfully
- [ ] GitHub release created
- [ ] Can install via `npm install -g mcp-code-context@2.1.3`
- [ ] Version shows correctly in `package.json`
- [ ] Tag visible on GitHub releases page
- [ ] CHANGELOG.md shows v2.1.3 entry
- [ ] Tests passing on CI (if configured)

## 🐛 Rollback Plan (If Needed)

If critical issues are discovered:

```bash
# Unpublish from npm (within 72 hours)
npm unpublish mcp-code-context@2.1.3

# Delete GitHub release
# Go to releases page and delete v2.1.3

# Delete git tag
git tag -d v2.1.3
git push origin :refs/tags/v2.1.3

# Revert commit
git revert f0bfcfe
git push origin main
```

## 📊 Monitoring

After release, monitor:
- npm download stats: https://npm-stat.com/charts.html?package=mcp-code-context
- GitHub issues for bug reports
- GitHub stars/forks for adoption

## 🎉 Success Criteria
- No critical bugs reported within 48 hours
- Windows users confirm CRLF issues resolved
- Download count increases
- Positive feedback from users

---

**Current Status**: Ready for npm publish and GitHub release creation
**Blocked By**: npm authentication required
**Next Action**: Run `npm login` then `npm publish`
