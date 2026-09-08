# Working Python script — extract crash signature from a .dmp

Paste and run with the dump path. Handles the non-fatal PEB decode error,
pulls the exception code, maps the faulting address to a module, and checks
whether stack memory is present (mini-dumps usually have none).

```python
from minidump.minidumpfile import MinidumpFile

DMP = "HamsterStore-GUI.exe.21764.dmp"   # <-- set path
mf = MinidumpFile.parse(DMP)             # ignore red PEB parsing error log line

# 1) exception
rec = mf.exception.exception_records[0]
er  = rec.ExceptionRecord
print("ExceptionCode_raw : 0x%X" % er.ExceptionCode_raw)
print("ExceptionAddress  : 0x%X" % er.ExceptionAddress)
print("ThreadId          :", rec.ThreadId)
print("Parameters        :", list(er.Parameters))

# 2) faulting module
addr = er.ExceptionAddress
hit = None
for m in mf.modules.modules:
    if m.baseaddress <= addr < m.baseaddress + m.size:
        hit = m; break
if hit:
    print("FAULTING MODULE   : %s  offset 0x%X" % (hit.name, addr - hit.baseaddress))
else:
    print("FAULTING MODULE   : <not in any loaded module>")

# 3) is stack memory even present? (mini-dumps often have none -> can't unwind)
segs = mf.memory_segments.memory_segments
total_stack = sum(len(s.data) for s in segs)
print("Memory segments   : %d  (total bytes %d)" % (len(segs), total_stack))
if total_stack == 0:
    print("NOTE: no stack memory captured -> cannot walk call stack; "
          "rebuild WITH PDB and reproduce to get the real call chain.")
```

Expected output shape for the HamsterStore 08-10 dump:
`ExceptionCode_raw = 0xC00000FD` (STACK_OVERFLOW), faulting module
`C:\Windows\System32\user32.dll`, and `total bytes 0` (no stack -> unreproducible
without a symboled rebuild).
