# Tiiextension Improvement Plan

**Version**: v1.3.0 → v1.4.0  
**Date**: 2026-07-13  
**Scope**: 7 improvement tracks from security, stability, observability, and DX

---

## Track 1: Cross-Browser Compatibility (Firefox + Edge parity)

**Objective**: Make extension run on Firefox MV3 without code duplication.

### Tasks
1.1 Create `src/browser-polyfill.js` - abstraction layer for `chrome.*` vs `browser.*` APIs
1.2 Refactor `native-client.js`, `popup.js`, `sidepanel.js` to import polyfill
1.3 Add Firefox `manifest.json` variant (`manifest.firefox.json`) with `browser_specific_settings`
1.4 Update `scripts/package-release.mjs` to build both Chrome/Edge and Firefox ZIPs
1.5 Add CI smoke test for Firefox (headless via Playwright)

**Acceptance**: Extension loads in Firefox Developer Edition, native messaging works, side panel renders.

---

## Track 2: ChatGPT Web Adapter Hardening

**Objective**: Reduce breakage when ChatGPT UI changes; add observability.

### Tasks
2.1 Create `src/chatgpt-selectors.json` - declarative selector map with fallbacks per UI region
2.2 Refactor `chatgpt-content.js` to use selector map + `MutationObserver` for dynamic regions
2.3 Add `selectorHealth` metric: log success/failure per selector to `diagnostic-log`
2.4 Implement `auto-heal` mode: on selector miss, scan for new candidate and persist to storage
2.5 Add `tests/chatgpt-adapter.selectors.test.mjs` - snapshot test selector map vs live DOM (manual)
2.6 Document selector update procedure in `docs/SELECTOR_MAINTENANCE.md`

**Acceptance**: Adapter survives 3 synthetic UI mutations; selector health dashboard visible in side panel.

---

## Track 3: Worker Payload Sandboxing

**Objective**: Harden payload execution boundary beyond Worker isolation.

### Tasks
3.1 Add `payload-limits` section to `runtime-config.schema.json` (cpuMs, heapMb, wallTimeMs)
3.2 Implement `src/payload-sandbox.js` - wraps Worker with:
   - `performance.now()` budget enforcement
   - `MemoryLimit` via `MessageChannel` heartbeat
   - Structured error codes: `PAYLOAD_CPU_EXCEEDED`, `PAYLOAD_OOM`, `PAYLOAD_WALLTIME`
3.3 Add AST pre-validation in `payload.load` using `acorn` (block `eval`, `Function`, dynamic import)
3.4 Update `docs/PAYLOADS.md` with sandbox limits and migration guide
3.5 Add `tests/payload-sandbox.test.mjs` - fuzz CPU/memory boundary

**Acceptance**: Malicious payload (infinite loop, 500MB allocation) terminated within limits; valid payloads unaffected.

---

## Track 4: Observability & Metrics

**Objective**: Production-grade visibility into runtime health.

### Tasks
4.1 Add `/v1/metrics` endpoint (Prometheus text format) exposing:
   - `tiiextension_tasks_total{status}` 
   - `tiiextension_tool_calls_total{tool,status}`
   - `tiiextension_native_latency_seconds{tool}`
   - `tiiextension_payload_duration_seconds`
   - `tiiextension_selector_health{selector,status}`
4.2 Implement `src/telemetry.js` - lightweight metrics collector (no external deps)
4.3 Add health check cron: `setInterval` → `/v1/health` → append to `runtime/health.log` (JSONL)
4.4 Side panel "Diagnostics" tab: show live metrics sparklines (canvas, no chart lib)
4.5 Alert rule: if `pending_calls > 100` or `task_failure_rate > 0.2` → log `WARN` to diagnostic

**Acceptance**: `curl localhost:18401/v1/metrics` returns valid Prometheus format; side panel shows live charts.

---

## Track 5: E2E Testing Coverage (Windows + CI)

**Objective**: Automated verification of critical user flows.

### Tasks
5.1 Create `tests/smoke-windows.ps1` - PowerShell script:
   - Load unpacked extension
   - Start native host
   - Run `doctor.ps1`
   - Execute `fs.tree`, `fs.read`, `fs.write` + rollback
   - Run `chat.start` with mock goal
   - Output JUnit XML for CI
5.2 Add Playwright test `tests/browser/e2e-critical.spec.js`:
   - Extension load → popup open → provider select → side panel tabs
   - Mock ChatGPT responses via `page.route`
5.3 Add GitHub Actions workflow `.github/workflows/windows-e2e.yml` (self-hosted runner)
5.4 Add `npm run test:e2e` script
5.5 Document local E2E run in `docs/E2E_TESTING.md`

**Acceptance**: `npm run test:e2e` passes on clean Windows VM; CI reports green.

---

## Track 6: Config Schema Validation & Migration

**Objective**: Prevent misconfiguration; enable safe upgrades.

### Tasks
6.1 Create `schemas/runtime-config.zod.ts` - Zod schema for `runtime.json` v2
6.2 Add `native-host/bin/agent-cli.js config validate` command
6.3 Add `native-host/bin/agent-cli.js config migrate --from v1 --to v2` with diff preview
6.4 Integrate validation into `install-native-host.ps1 -Action Repair`
6.5 Add `tests/config-validation.test.mjs` - invalid config rejected, valid config passes

**Acceptance**: Invalid config produces actionable error with path; migration preserves roots/allowlist.

---

## Track 7: Side Panel UX Polish

**Objective**: Daily-driver ergonomics.

### Tasks
7.1 Add global command palette: `Ctrl+K` → `src/command-palette.js` (fuzzy search over tools, files, actions)
7.2 Implement dark/light theme toggle persisted in `chrome.storage.local`
7.3 Add virtualized file tree (`IntersectionObserver`) for >5k entries
7.4 Loading skeleton for file tree + search results (CSS-only)
7.5 Keyboard shortcuts help overlay (`?` key) showing all bindings
7.6 Add `tests/ui-contract.test.mjs` snapshot for palette, theme, virtualization

**Acceptance**: `Ctrl+K` opens palette <50ms; theme persists reload; 10k file tree scrolls smoothly.

---

## Cross-Cutting Concerns

| Concern | Approach |
|---------|----------|
| **Backward compatibility** | All changes behind feature flags; `runtime.json` `features` object |
| **Testing** | Each track adds unit + integration tests; `npm test` must pass before merge |
| **Documentation** | Update `README.md`, `VERIFICATION.md`, `docs/*.md` per track |
| **Release** | `npm run package` produces `Tiiextension-v1.4.0.zip` + Firefox variant |

---

## Prioritization (suggested order)

1. **Track 6** (Config validation) - prevents runtime stability)
2. **Track 4** (Observability) - enables debugging other tracks
3. **Track 2** (Adapter hardening) - highest user-visible risk
4. **Track 3** (Sandboxing) - security hardening
5. **Track 1** (Firefox) - expands audience
6. **Track 5** (E2E) - confidence for releases
7. **Track 7** (UX) - quality of life

---

## Definition of Done per Track

- All tasks checked off
- `npm test` passes (77+ tests)
- `npm run check` passes (syntax)
- `npm run static-check` passes (UI contracts)
- `VERIFICATION.md` updated with new evidence
- CHANGELOG entry added