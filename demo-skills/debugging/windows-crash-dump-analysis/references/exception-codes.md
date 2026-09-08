# Common Windows exception codes

Raw integer values returned in `ExceptionRecord.ExceptionCode_raw`.

| Raw (hex) | Name | Meaning / triage |
|-----------|------|------------------|
| `0xC0000005` | STATUS_ACCESS_VIOLATION | Read/write to invalid pointer — NULL deref, use-after-free, bad cast. Faulting module + offset usually points at the offending function. |
| `0xC00000FD` | EXCEPTION_STACK_OVERFLOW | Stack exhausted. In a GUI app with the fault inside `user32.dll`/`ntdll.dll` during message dispatch, this is **infinite recursion** in widget construction or an event callback that re-enters. Audit build/event re-entrancy, not click handlers. |
| `0xC000001D` | STATUS_ILLEGAL_INSTRUCTION | CPU hit an instruction it can't run (e.g. AVX2/BMI2 on a CPU lacking them). Common when a build was compiled with `-Ctarget-cpu=x86-64-v3`/`-v4` but the runtime host lacks the extensions. |
| `0xC0000094` | STATUS_INTEGER_DIVIDE_BY_ZERO | Division by zero. |
| `0xC0000374` | STATUS_HEAP_CORRUPTION | Heap metadata clobbered — double free, buffer overrun in native interop. |
| `0xC0000409` | STATUS_STACK_BUFFER_OVERRUN | /GS security cookie tripped — buffer overrun. |
| `0x80000003` | STATUS_BREAKPOINT | Hard-coded breakpoint / assertion. |

Note: `.ExceptionInformation` carries extra detail — for `ACCESS_VIOLATION` it is `[0=write/1=read/8=execute, faulting VA]`; for `STACK_OVERFLOW` it is `[1, guard-page VA]`.
