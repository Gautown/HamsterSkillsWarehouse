# Hermes Desktop Windows build — troubleshooting detail

File patched: `%LOCALAPPDATA%\hermes\hermes-agent\apps\desktop\scripts\stage-native-deps.mjs`
(inside the `hermes-agent` git checkout — a `git pull` may revert these edits).

## Symptom
`✗ Desktop GUI build failed` after `vite build` + `bundle-electron-main` succeed,
during `node scripts/stage-native-deps.mjs`. One of:
- `get-windows is not installed; cannot stage its win32-x64 native payload`
  (package absent — npm skipped the optionalDependency because its install
  script failed on GitHub download + no local compile).
- `get-windows has no win32-x64 prebuilt binding under lib/binding`
  (package present from a manual `npm install get-windows` but no `.node`
  binary under `lib/binding/`).

## Root cause
`get-windows@9.3.0` is an optionalDependency staged for the `read_window_below`
tool. Its native binary comes from a GitHub Releases prebuild OR a local
node-gyp compile (needs VS "Desktop development with C++" + MSBuild). On a
network-blocked Windows box with no MSVC toolchain, neither path works, and the
script is **fail-closed for win32-x64** (linux and win-arm64 already degrade).

## The 3 edits (find → replace)

### Edit 1 — top-level degrade branch (srcRoot is null)
Find:
```js
    const canDegrade = platform === 'linux' || (platform === 'win32' && arch === 'arm64')
```
Replace with:
```js
    // win32-x64: degrade instead of fail-closed when the native payload can't be
    // staged (no GitHub access / no MSVC toolchain to compile locally). The
    // runtime import already fails soft, so only window enumeration is lost.
    const canDegrade = platform === 'linux' || platform === 'win32'
```

### Edit 2 — skip the local compile attempt for win32
Find:
```js
    } else if (bindingDirs.length === 0 && typeof install === 'function') {
```
Replace with:
```js
    } else if (bindingDirs.length === 0 && typeof install === 'function' && platform !== 'win32') {
```

### Edit 3 — don't throw when win32 has no binding
Find:
```js
    if (bindingDirs.length === 0 && arch !== 'arm64') {
```
Replace with:
```js
    if (bindingDirs.length === 0 && platform !== 'win32' && arch !== 'arm64') {
```

## After patching
```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
cd "$LOCALAPPDATA/hermes/hermes-agent"
hermes desktop --force-build
```
The build prints `→ Launching packaged Hermes Desktop: ...\release\win-unpacked\Hermes.exe`.

## Confirming the native dep is genuinely unavailable (optional)
```bash
# Is the package even present?
ls "$LOCALAPPDATA/hermes/hermes-agent"/node_modules/get-windows 2>&1
# Does it have a compiled binding?
find "$LOCALAPPDATA/hermes/hermes-agent" -path '*get-windows/lib/binding*' -name '*.node' 2>/dev/null
# Can we reach GitHub at all?
curl -sI -m 20 https://github.com/sindresorhus/get-windows/releases/download/v9.3.0/napi-9-win32-unknown-x64.tar.gz
```
If the curl returns nothing and there's no `.node` file, the degrade patch is the
correct move.

## Impact of the patch
Only the `read_window_below` tool (reading the window beneath the cursor) loses its
native window enumeration. Everything else — chat, sessions, skills, tools,
browser, terminal, voice — works normally.
