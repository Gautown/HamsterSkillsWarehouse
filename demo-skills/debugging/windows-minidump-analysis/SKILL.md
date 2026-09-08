---
name: windows-minidump-analysis
description: Analyze Windows .dmp crash dumps without WinDbg.
version: 1
author: hermes-agent
license: MIT
metadata:
  hermes:
    tags: [debugging, windows, crash, minidump, native-app]
    related_skills: []
    crate_date: 2026-08-27
---

# Windows Minidump Crash Analysis (no WinDbg needed)

When an `.exe` crashes and leaves a `.dmp` (minidump) — typically under
`%LOCALAPPDATA%\CrashDumps\` — you usually don't have WinDbg/cdb on the box.
The pure-Python `minidump` package parses the file and gives you the
**exception record** directly. That's enough to classify the crash
(stack overflow vs access violation vs illegal instruction) and name the
faulting binary, which routes the fix.

## When to use
- A crash dump exists (`*.dmp`, first 4 bytes `MDMP`) and you need the
  exception type + faulting module fast.
- No PDB available — mini-dumps still carry the exception stream.
- You want to know whether it's recursion, a bad pointer, or a CPU mismatch
  before spending time rebuilding with symbols.

## Prereqs
```
pip install minidump
```
Pure Python, no native deps. Runs fine from the Hermes venv.

## Pipeline
1. Confirm minidump: first 4 bytes == `MDMP`.
2. Parse + read the exception stream (see `references/parse_recipe.py`, a
   ready-to-run script; `references/exception_codes.md` is the decoder table).
3. Map `ExceptionAddress` to a loaded module to name the faulting binary.
4. Check the crash thread's stack memory — **mini-dumps frequently have NO
   stack bytes**, so you usually cannot walk the call chain. Say so, rather
   than asserting a root cause you can't prove.
5. Use the exception code to route the fix (table below).

## Critical API quirks / pitfalls
- `MinidumpFile.parse()` prints a `PEB parsing error!` `UnicodeDecodeError`
  traceback on some dumps. **Non-fatal** — parsing still completes and the
  exception/modules/threads are populated. Don't abort on it.
- `rec.ExceptionRecord.ExceptionCode` is an **enum**
  (`ExceptionCode.EXCEPTION_STACK_OVERFLOW: 3221225725`), so
  `print("0x%X" % er.ExceptionCode)` raises `TypeError`. Use
  **`er.ExceptionCode_raw`** for the integer.
- `ExceptionAddress` is a plain absolute int.
- `mf.modules.modules` entries expose `.name`, `.baseaddress`, `.size`.
  Faulting module = the one where `base <= addr < base + size`.
- Crash thread id = `mf.exception.exception_records[0].ThreadId`. Match it in
  `mf.threads.threads` by `.ThreadId`.
- Live register context = `thread.ContextObject` (a `CONTEXT`): use `.Rip`/`.Rsp`
  (x64) or `.Eip`/`.Esp` (x86).
- Stack bytes live in `mf.memory_segments.memory_segments` (each has
  `.start_virtual_address` + `.data`). For mini-dumps this is often **empty**
  (`len(data) == 0`) → no stack walk. When present, scan qwords for addresses
  inside the main `.exe`; the **most-repeated module offset** is the recursion
  signature (see script).

## What the exception type tells you (route the fix)
- `0xC00000FD` STACK_OVERFLOW → infinite recursion / unbounded runtime layout
  recursion (e.g., a GUI widget tree rebuilt recursively). Rebuild WITH a symbol
  PDB to confirm the call chain.
- `0xC0000005` ACCESS_VIOLATION → null/bad-pointer deref; often a missing import
  or a module whose top-level init throws silently at load.
- `0xC000001D` ILLEGAL_INSTRUCTION → CPU feature mismatch (e.g., AVX2/AVX-512
  built for a host without it). For native builds, drop `-Ctarget-cpu=x86-64-v3/4`.
- `0xC0000094` INT_DIVIDE_BY_ZERO, `0x80000003` BREAKPOINT.

## Limitations
- Without a PDB + the *matching* binary you cannot symbolicate addresses to
  function names.
- If the crashing binary was overwritten by a newer build, the dump no longer
  matches — the crash is **unreproducible**; capture the source into version
  control before anything else.
- `*.pdb` is often gitignored — if so, future crashes stay un-debuggable.
  Un-ignore PDBs (or emit them to a side path) for the build you intend to ship.
