---
name: hermes-desktop-install
description: "Hermes Desktop on Windows: bypass get-windows build abort."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [windows]
---

# Hermes Desktop Install & Build (Windows)

Hermes Desktop is NOT a separate product — it's the same agent core behind a native
Electron UI. If `hermes` (CLI) is already installed, launching the desktop is just
`hermes desktop`, which **builds** the Electron app on first run then launches it.

## When to use
- User says "install Hermes Desktop", "open the Hermes app", "launch the GUI", or
  `hermes desktop` failed / hung.
- User is on Windows and the Desktop build aborts on a native dependency.

## Quick start (happy path)
```bash
# If hermes CLI already installed, just launch — first run builds the app:
hermes desktop

# Force a clean rebuild (needed after patching source, or to retry a failed build):
hermes desktop --force-build

# Normal relaunch without rebuilding (fast):
hermes desktop --skip-build
```
Build artifacts: `%LOCALAPPDATA%\hermes\hermes-agent\apps\desktop\release\win-unpacked\Hermes.exe`.
The CLI and Desktop share the same `HERMES_HOME` (`%LOCALAPPDATA%\hermes`),
sessions, keys, and skills — switch between GUI and CLI freely.

## Prerequisites
- `hermes`` on PATH. Native Windows install (PowerShell, no admin):
  `iex (irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1)`
- The build runs `npm install` in `apps/desktop`, a vite/tsc build, then
  `electron-builder --dir` (downloads Electron ~114MB).

## Pitfall 1: `get-windows` fail-closed build abort (Windows)
`apps/desktop/scripts/stage-native-deps.mjs` stages `get-windows` — an optional
native dep used ONLY for the `read_window_below` tool (reading the window beneath
the cursor). For `win32-x64` the script is **fail-closed**: if the native binary
can't be staged, it throws and the WHOLE Desktop build dies.

Two ways the binary fails to appear on a Windows box behind a restricted network:
1. **GitHub blocked** — `get-windows` downloads its prebuilt `.node` from
   `github.com/sindresorhus/get-windows/releases/download/v9.3.0/...`. No GitHub
   access → no prebuilt. (Check: `curl -sI <asset-URL>` returns nothing.)
2. **No MSVC toolchain** — the fallback is a local C++ compile via node-gyp, which
   needs Visual Studio "Desktop development with C++" (incl. MSBuild.exe).
   VS2022 BuildTools without that workload → `gyp ERR! Could not find any Visual Studio installation`.

Symptom: `✗ Desktop GUI build failed` with
`stage-native-deps] get-windows is not installed; cannot stage its win32-x64 native payload`
(or, if the package IS on disk but uncompiled, the `stageGetWindowsInto` throw).

### Workaround (TESTED — build succeeds, app launches)
Patch `stage-native-deps.mjs` so `win32` degrades softly instead of failing. The
runtime already fails soft on a missing binding; only window enumeration is lost.
Exact 3 find-and-replace edits (with surrounding context) are in
`references/build-troubleshooting.md`. After patching:
```bash
hermes desktop --force-build
```

## Pitfall 2: Electron download blocked
The pack step downloads Electron (~114MB) from GitHub. If GitHub is blocked, pin
the npmmirror mirror (the build auto-falls back to npmmirror, but pinning is
faster/reliable):
```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
hermes desktop --force-build
```

## Verification
After a successful build the app auto-launches. Confirm:
```bash
tasklist | grep -i Hermes.exe        # multiple Hermes.exe processes running
ls "$LOCALAPPDATA/hermes/hermes-agent/apps/desktop/release/win-unpacked/Hermes.exe"
```

## Notes / gotchas
- The `stage-native-deps.mjs` patch lives in the `hermes-agent` git repo. A future
  `git pull` / `hermes` update may revert it; re-apply if `hermes desktop` starts
  failing on `get-windows` again.
- If GitHub becomes reachable, the upstream build works unmodified and
  `read_window_below` gains native support — no patch needed then.
- Don't hand-edit `~/.hermes/config.yaml` for the user; use `hermes config set`.
- The `hermes-agent` bundled skill is the product hub (mentions `hermes desktop`
  briefly) but is protected — this skill carries the Windows build-specific detail.
