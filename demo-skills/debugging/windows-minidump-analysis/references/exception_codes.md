# Windows exception codes (NTSTATUS / Win32)

Use the integer from `er.ExceptionCode_raw` (NOT the enum object). The most
common crash-classifying codes:

| Code (hex) | Name | Meaning / routing |
|---|---|---|
| `0xC00000FD` | EXCEPTION_STACK_OVERFLOW | Stack exhausted. Almost always **infinite recursion** or unbounded runtime recursion (e.g. a GUI widget tree rebuilt recursively). Rebuild WITH a symbol PDB to confirm the cycle. |
| `0xC0000005` | EXCEPTION_ACCESS_VIOLATION | Bad/null pointer deref. Often a missing import, or a module whose top-level init throws silently at load (blank-window class of bugs). `Parameters[0]` = 0 read, 1 write; `Parameters[1]` = faulting address. |
| `0xC000001D` | EXCEPTION_ILLEGAL_INSTRUCTION | CPU executed an opcode it doesn't support. Classic **CPU-feature mismatch** — e.g. binary built with `-Ctarget-cpu=x86-64-v3/v4` (AVX2/BMI2/FMA) on a host without it. Drop the target-cpu override. |
| `0xC0000094` | EXCEPTION_INT_DIVIDE_BY_ZERO | Integer divide by zero. |
| `0xC0000096` | EXCEPTION_PRIV_INSTRUCTION | Privileged instruction in user mode. |
| `0xC0000374` | STATUS_HEAP_CORRUPTION | Heap corruption (double free / overrun). |
| `0xC0000409` | STATUS_STACK_BUFFER_OVERRUN | /GS buffer overrun (/FASTFAIL). |
| `0x80000003` | EXCEPTION_BREAKPOINT | Hard-coded breakpoint / assert. |
| `0xC00000FD` | (see above) | |

## Parameters field
`er.Parameters` is a list of ints (`NumberParameters` tells how many are valid).
For ACCESS_VIOLATION: `[0]=operation (0 read /1 write /8 execute), 1=faulting VA]`.
For STACK_OVERFLOW: `[1, <stack-region-low>]`, usually not directly useful.

## Faulting module
Map `er.ExceptionAddress` into `mf.modules.modules` by
`base <= addr < base+size`. If the faulting module is `user32.dll` /
`ntdll.dll` / `win32u.dll` rather than the app `.exe`, the crash happened
**during message dispatch / OS call** — the real bug is in the app code that
triggered it (e.g. recursive widget rebuild driving the message loop), not in
the OS module itself.
