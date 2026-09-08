#!/usr/bin/env python3
# Ready-to-run minidump analyzer. Usage:
#   python parse_recipe.py /path/to/Crash.dmp
# Works without PDB, without WinDbg. Prints exception code, faulting module,
# and the crash thread. NOTE: mini-dumps often have empty stack memory, so the
# stack-walk section may report "no stack bytes" — that is expected.
import sys, struct
from collections import Counter
from minidump.minidumpfile import MinidumpFile

DMP = sys.argv[1] if len(sys.argv) > 1 else sys.exit("usage: parse_recipe.py <dump.dmp>")
mf = MinidumpFile.parse(DMP)

rec = mf.exception.exception_records[0]
er = rec.ExceptionRecord
code = er.ExceptionCode_raw
addr = er.ExceptionAddress
print(f"=== EXCEPTION ===")
print(f"ExceptionCode: 0x{code:X}  ({er.ExceptionCode})")
print(f"ExceptionAddress: 0x{addr:X}")
print(f"ThreadId: {rec.ThreadId}")
print(f"Params: {list(er.Parameters)}")

# module map
mods = mf.modules.modules
def mod_for(a):
    for m in mods:
        b = m.baseaddress
        if b <= a < b + m.size:
            return m.name, b, m.size
    return None, None, None

name, base, size = mod_for(addr)
print(f"FAULTING MODULE: {name}  rel 0x{addr-base:X}" if base else f"FAULTING MODULE: {name}")

print(f"\n=== modules ({len(mods)}) ===")
for m in mods:
    print(f"0x{m.baseaddress:X} +0x{m.size:X}  {m.name}")

# stack walk (often empty on mini-dumps)
seg = None
for s in mf.memory_segments.memory_segments:
    sv = getattr(s, 'start_virtual_address', None)
    data = getattr(s, 'data', b'')
    if sv is not None and sv <= addr < sv + len(data):
        seg = s; break
if seg is not None and len(seg.data):
    data = seg.data
    base_exe = mods[0].baseaddress
    addrs = []
    p = 0
    while p + 8 <= len(data):
        v = struct.unpack_from('<Q', data, p)[0]
        if base_exe <= v < base_exe + mods[0].size:
            addrs.append(v - base_exe)
        p += 8
    if addrs:
        print(f"\n=== top repeated exe offsets (recursion signature) ===")
        for off, c in Counter(addrs).most_common(15):
            print(f"0x{off:X} x{c}")
    else:
        print("\nNo exe addresses found on stack.")
else:
    print("\nNo stack memory in dump (mini-dump) — cannot walk call chain.")
