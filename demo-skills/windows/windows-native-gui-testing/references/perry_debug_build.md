# Perry Windows GUI — build for debuggability

When you ship/compile a Perry-compiled Windows GUI `.exe` (e.g. HamsterStore),
build it so a future crash can actually be debugged. Two perry flags matter:

## `--debug-symbols`
Adds `/DEBUG` to the lld-link invocation → emits a `<name>.pdb` alongside the
`.exe`. The PDB is matched to the exe by an internal GUID+age.

Why it matters: the 08-10 HamsterStore `HamsterStore-GUI.exe` crash was
`EXCEPTION_STACK_OVERFLOW (0xC00000FD)` inside `user32.dll` during message
dispatch, but the mini-dump carried **no stack memory** AND **no PDB had ever
been emitted** (`*.pdb` is typically gitignored). Result: the crash was
**unreproducible and un-debuggable** for weeks. A matching `.pdb` would have
symbolized the `perry-runtime` + user frames to `file:line` under WinDbg/`cdb`.

## `--emit-attest`
Writes `<name>.exe.attest.json` next to the binary, pinning:
- `sha256` of the binary
- `perry_version`
- `built_at_unix`

Use it to map a crash dump back to the exact binary/source: read the dump's
attest sha256 → rebuild the same `src` with `perry compile --debug-symbols` →
pair the resulting `.pdb` with the crashed `.exe` in WinDbg/cdb.

## example (package.json script)
```
"build:gui": "perry compile src/gui/main.ts -o dist/HamsterStore-GUI.exe \
  --target windows --min-windows-version 10 --debug-symbols --emit-attest",
"build:cli": "perry compile src/main.ts -o dist/HamsterStore.exe --emit-attest"
```

## gitignore note
`*.pdb` is usually gitignored (releases stay small), but that is exactly why
crash symbols were missing. To ship a debuggable release, add a negation:
```
*.pdb
!HamsterStore-GUI.pdb
```
and force-add the pair: `git add -f dist/HamsterStore-GUI.pdb dist/HamsterStore-GUI.exe.attest.json`.

## caveat
`commit_sha` in the attest is empty when the build directory itself is not a git
repo. Build inside the actual repo (or set the build copy to be the git working
tree) so the attest records the commit.
