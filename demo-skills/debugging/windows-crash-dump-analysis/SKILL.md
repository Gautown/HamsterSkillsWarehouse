---
name: windows-crash-dump-analysis
description: Analyze .dmp crashes without WinDbg via Python minidump.
version: 1
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [windows, debugging, crash, minidump, reverse-engineering]
    related_skills: [git-proxy-push]
---

# Windows Crash Dump Analysis (no WinDbg)

When a Windows app crashes you usually get a `.dmp` (minidump) — e.g. `%LOCALAPPDATA%\CrashDumps\App.exe.PID.dmp`. The `minidump` PyPI package parses these in pure Python, so you get the crash signature (exception code + faulting module) in seconds without installing the Windows SDK/Debugging Tools. That signature is usually enough to localize the bug: SIGSEGV vs stack overflow vs access violation, and which DLL was executing at fault time.

## When to use
- A `.dmp` exists and you need the crash signature fast.
- No `cdb.exe` / `windbg.exe` on the box (common on dev machines — search for it first, but don't expect it).
- You want triage before attempting a full symboled (PDB) debug build.

## Setup
```
pip install minidump
```
It is the PyPI `minidump` package. The top-level entry is `minidump.minidumpfile.MinidumpFile` — NOT `minidump.Minidump` (that attribute does not exist).

## Steps
1. Parse: `mf = MinidumpFile.parse("file.dmp")`. Ignore the red `PEB parsing error` / `UnicodeDecodeError` log line — it is a non-fatal PEB environment-block decode failure; the parse still returns a usable object.
2. Read the exception record:
   ```python
   rec = mf.exception.exception_records[0]
   er  = rec.ExceptionRecord
   print(er.ExceptionCode_raw)   # raw int, e.g. 3221225725 = 0xC00000FD
   print(er.ExceptionAddress)    # faulting absolute VA
   print(rec.ThreadId)           # crashing thread id
   ```
3. Map the faulting address to a loaded module:
   ```python
   for m in mf.modules.modules:
       if m.baseaddress <= er.ExceptionAddress < m.baseaddress + m.size:
           print(m.name, "offset 0x%X" % (er.ExceptionAddress - m.baseaddress))
   ```
4. Decode the code (see references/exception-codes.md).

## Pitfalls
- **Mini-dumps have NO stack memory.** `mf.memory_segments.memory_segments[].data` is frequently length 0, so you cannot walk the call stack or pinpoint the recursive frame from the dump alone. If you need the call chain, you MUST rebuild the binary **with symbols (PDB)** and reproduce — a dump without a matching PDB is effectively unreproducible.
- `ExceptionCode` prints as an enum (`ExceptionCode.EXCEPTION_STACK_OVERFLOW: 3221225725`); use `.ExceptionCode_raw` for the integer.
- The crash thread's `Rip`/`Rsp` live in `mf.threads.threads[i].ThreadContext` (or `.ContextObject`), but without stack memory they are not enough to unwind.
- A **stack overflow (0xC00000FD) faulting inside `user32.dll`/`ntdll.dll` during message dispatch** = infinite recursion in a UI event/build path (a window was shown and the message loop was running), NOT a logic error inside a click handler. Audit widget construction / event re-entrancy, not button callbacks.

## References
- `references/exception-codes.md` — common exception codes and what they mean.
- `references/minidump-python.md` — full working script (exception + module map + stack-memory emptiness check).
