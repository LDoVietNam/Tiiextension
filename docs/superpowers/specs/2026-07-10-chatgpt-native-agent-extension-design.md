# ChatGPT Native Agent Extension Design

## Goal

Build a complete Windows-first Chrome/Edge MV3 extension that uses ChatGPT Web as the primary model provider, controls the browser autonomously, and delegates durable runtime work to a native messaging host with workspace-limited filesystem tools and hot payload support.

## Architecture

The extension is the browser/UI/provider bridge. It parses structured JSON blocks from ChatGPT Web or the side panel, executes browser actions, and routes native work to the host.

The native host is the runtime source of truth. It owns task queue state, logs, workspace guard, filesystem tools, payload loading, command execution, and policy enforcement.

## Runtime Policy

- Full autonomous execution after installation.
- No per-action permission prompts inside the runtime.
- Filesystem and process actions are allowed only inside configured workspace folders.
- Policy violations are rejected automatically and logged.
- Dev mode loads hot payloads without signature checks.
- Release mode requires payload manifest checksum/signature metadata.

## Target

- Windows.
- Chrome and Edge Chromium.
- Manifest V3.
- Native messaging from v1.
- ChatGPT Web provider from v1.
- Optional OpenAI native host compatibility probing.

## Structured Blocks

ChatGPT responses can contain independent JSON blocks with dedicated schemas:

- `agent_action`
- `tool_call`
- `payload_load`
- `filesystem_read`
- `filesystem_write`
- `filesystem_patch`
- `filesystem_search`
- `task_result`

## Filesystems Scope

The native host exposes workspace-limited tools:

- `fs.list`
- `fs.tree`
- `fs.read`
- `fs.write`
- `fs.patch`
- `fs.delete`
- `fs.move`
- `fs.copy`
- `fs.search`
- `fs.stat`
- `fs.watch`

## Deliverable

A zip package containing:

- MV3 extension source.
- Node.js native host.
- Windows install/uninstall scripts for Chrome and Edge native messaging.
- Workspace configuration example.
- Payload example.
- Tests and README.

