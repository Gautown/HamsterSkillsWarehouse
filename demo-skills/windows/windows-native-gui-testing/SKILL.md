---
name: windows-native-gui-testing
description: Smoke-test native Windows GUI apps via ctypes capture, BM_CLICK driving, and liveness checks.
version: 1
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [windows, gui, smoke-test, perry, ctypes, screenshot, debugging]
    related_skills: [windows-minidump-analysis]
---

# Windows Native GUI Testing (capture + drive)

## When to use
You need to visually verify or drive a Windows desktop app that is a **native** executable — `subsystem=windows`, a real Win32 window — not a browser, not a UWP/WinUI/MSIX app. Common case: apps compiled from TypeScript via **Perry** (`perry compile --target windows`), or any C++/Rust/Go Windows build. The app shows up in `tasklist` with a real `hwnd` and window title, but the usual automation tooling can't reach it.

## Why the usual tools fail here (so you don't waste iterations)
- **`computer_use` (cua-driver)** enumerates windows through an accessibility/overlay layer. Native `subsystem=windows` apps often expose no trackable overlay window, so `list_windows` and `capture` return nothing even though the process is running with a valid `hwnd` and title. Symptom: list_windows shows Calculator/Edge/explorer but NOT your app.
- **PowerShell `Add-Type` with `System.Drawing`** fails on PowerShell Core / many editions where GDI+ assemblies aren't loaded — `using System.Drawing` compile errors cascade into `TypeNotFound`.
- **`pywin32` (`win32gui`) and `Pillow` are frequently NOT installed** in the agent's Python. `ModuleNotFoundError`.
- **Minimized/off-screen windows** report tiny or negative rects (e.g. `-32000,-32000`) from `GetWindowRect`. Always call `ShowWindow(hwnd, SW_RESTORE)` before `PrintWindow` to get a real client rect. `PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT)` also works for off-screen windows but requires the flag `0x2`.

## The reliable path: Python `ctypes` + user32/gdi32 (stdlib only)
No external packages. Recipe that works:
1. Find window via `user32.EnumWindows`; in the callback read `GetWindowTextW`, filter on a stable title substring.
2. Get rect via `user32.GetWindowRect`. ⚠️ A *minimized* window reports a tiny rect (e.g. 160×28). Launch NORMAL (PowerShell `Start-Process` without `-WindowStyle Minimized`) for the real size.
3. Blit + read: `user32.GetWindowDC(hwnd)` → `gdi32.CreateCompatibleDC`/`CreateCompatibleBitmap` → `user32.PrintWindow(hwnd, memdc, 0)` → `gdi32.GetDIBits`.
4. Encode PNG with stdlib `zlib` + `struct` (hand-roll IHDR/IDAT/IEND). No Pillow.
5. Save to a project path and run `vision_analyze` on it to read the pixels.

### Pitfalls
- `GetDIBits` returns **BGRA 32-bit, bottom-up** rows. Flip vertically (iterate `y` from `h-1` down) and drop alpha → 24-bit RGB PNG.
- The `EnumWindows`/`EnumChildWindows` callback MUST be wrapped in `ctypes.WINFUNCTYPE(ctypes.c_int, ctypes.c_int, ctypes.c_void_p)` or it crashes on the second window (raw Python callable rejected by Win32 ABI).
- `tasklist` stdout can contain non-UTF8 bytes → decode with `errors='replace'`, or check liveness another way.

## Driving the UI (click buttons without computer_use)
1. Enumerate children with `user32.EnumChildWindows`; read text (`GetWindowTextW`) + class (`GetClassNameW`). Native buttons are class `Button`.
2. Click via `user32.PostMessageW(child_hwnd, 0x00F5 /* BM_CLICK */, 0, 0)`. Sleep ~0.35 s between clicks (app rebuilds its widget tree synchronously on click; don't flood it).
3. **Liveness = your crash signal.** After clicking every nav page, check the process is still alive. A native GUI that stack-overflows (e.g. `EXCEPTION_STACK_OVERFLOW` from a layout recursion) dies on a specific navigation — surviving all pages refutes a launch/path-level recursion bug.
4. Exit cleanly with `user32.PostMessageW(hwnd, 0x0010 /* WM_CLOSE */, 0, 0)`.
5. **Delete screenshots after** so they don't get committed.

## Verification pattern (end-to-end smoke test)
Launch exe (PowerShell `Start-Process -PassThru` → PID) → screenshot home → drive every nav page via BM_CLICK → assert still alive → WM_CLOSE → `vision_analyze` the screenshots → clean up. For a Perry/TS app, build first with `--debug-symbols` (see `references/perry_debug_build.md`) so any crash is debuggable.

## References
- `references/ctypes_capture.py` — working capture-to-PNG script (find hwnd → PrintWindow → stdlib PNG). Fixed: uses `c_ubyte` array for proper BGRA indexing; handles SW_RESTORE before capture.
- `references/drive_clicks.py` — working nav-click + liveness script. Uses PID-based lookup as primary method (more reliable than title matching).
- `references/perry_debug_build.md` — build a Perry/TS Windows exe that emits a `.pdb` + attest so crashes are reproducible.
- `references/perry-node-http-limitation.md` — Perry v0.5.1220: `import * as http from "node:http"` compiles but links `js_http_get_overload undefined`; use curl spawn instead.
- `references/perry-source-copy-vs-git-repo.md` — Perry projects use a non-git source copy for builds while the real repo is elsewhere; sync pattern.
- `references/hamsterskill-filedb-layout.md` — HamsterStore FileDB data layout, `extra_json` flattening, and per-table JSON files.
