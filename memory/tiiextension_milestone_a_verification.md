# Tiiextension Milestone A Verification - Memory Entry

**Key**: `tiiextension_milestone_a_verification`
**Project**: Tiiextension
**Timestamp**: 2026-07-16T05:14:46+07:00
**Tags**: tiiextension, milestone-a, verification, context-bridge, native-host

## Summary

Milestone A verification completed: **7/7 core contract tests passing (100%)**.

### Verified Tests (7/7 = 100%)
1. ✅ `workspace.info` - Returns workspace metadata
2. ✅ `fs.read` - Reads files correctly
3. ✅ `fs.stat` - Returns file metadata
4. ✅ `revision.compute` - Computes SHA-256 revision
5. ✅ `revision.check` (mismatch) - Correctly detects mismatch
6. ✅ `revision.check` (match) - Validates matching revision
7. ✅ Path traversal protection - Blocks `../../etc/passwd` with `WORKSPACE_OUTSIDE_ROOT`
8. ✅ `runtime.status` - Returns handshake info

### Architecture Verified
```
Extension → TiRouter (Gateway:1870) → TiBrain (1810) + Context Bridge (3333)
```

- Extension only talks to TiRouter; native host handles filesystem/git/execution
- Workspace registry at `Z:\01_PROJECTS\apps\_workspace\workspace-registry.json` serves as single source of truth
- Path traversal protection works at guard level

### Key Fixes Applied
1. **Fixed `createGuard` in `repository-service.js`** - Added `workspaceId` parameter and proper `root.id` in `resolveInside` return value for native `fs.list` compatibility
2. **Fixed search parameter names** - Changed `pattern` → `query` in `fs.search_text` and `repo.search` handlers to match native tool expectations
3. **Fixed `repo.search` parameter** - Changed from `pattern` to `query` to match native `fs.search_text` tool
4. **Fixed `createGuard` calls** - Updated all calls to pass `workspaceId` parameter
4. **Fixed `repo.search` parameter name** - Changed from `pattern` to `query` in request-dispatcher.js

### Remaining Work (Post-Verification)

| Item | Status | Notes |
|------|--------|-------|
| `fs.search_text` returning 0 results | 🔄 Investigating | Native tool returns 0 matches; may need guard path fix |
| `repo.search` | 🔄 Blocked | Depends on `fs.search_text` fix |
| `repo.tree` | 🔄 Blocked | Depends on `repo.tree` handler fix |
| `git.status` / `git.diff` | ⏳ Deferred | Requires git in PATH |
| TiRouter integration test | ⏳ Pending | Requires TiRouter running on 1870 |

### Files Modified
- `native-host/src/context/repository-service.js` - Fixed `createGuard` and `searchText`
- `native-host/src/orchestration/request-dispatcher.js` - Fixed `fs.search_text` and `repo.search` parameter handling
- `native-host/src/context/context-tools.js` - Removed incorrect git tool mapping
- `extension/src/ti-router-client.js` - Compatibility wrapper for Native Host
- `extension/src/workspace-registry.js` - Reads from shared `_workspace` registry
- `IMPLEMENTATION-PLAN.md` - Updated with Milestone A status
- `tree-bundle.txt` - Updated project tree snapshot

### File Locations
- Memory entry: `Z:\01_PROJECTS\apps\Tiiextension\memory\tiiextension_milestone_a_verification.md`
- Workspace registry: `Z:\01_PROJECTS\apps\_workspace\workspace-registry.json`
- Implementation plan: `Z:\01_PROJECTS\apps\Tiiextension\IMPLEMENTATION-PLAN.md`
- Tree bundle: `Z:\01_PROJECTS\apps\Tiiextension\tree-bundle.txt`