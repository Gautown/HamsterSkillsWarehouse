"""Capture a native Windows GUI window to a PNG using only the Python stdlib.

Works when computer_use / PowerShell System.Drawing / pywin32 are unavailable.
Usage: python ctypes_capture.py  (edit WINDOW_SUBSTR / OUT_PATH)

Session notes (2026-09-01):
- Minimized/off-screen windows report -32000 coords from GetWindowRect.
  Always call ShowWindow(hwnd, SW_RESTORE) before PrintWindow.
- PW_RENDERFULLCONTENT (0x2) flag needed for PrintWindow to capture
  content of off-screen windows; without it the bitmap is black.
- DIB bits come back as c_ubyte values (NOT bytes) when accessed via
  (c_ubyte * size).from_buffer(buf). Use separate assignment per byte
  to avoid TypeError when building rgba list.
- BGRA stride is bottom-up; iterate y from h-1 down and swap B<->R.
"""
import ctypes, zlib, struct, time

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32
kernel32 = ctypes.windll.kernel32

WINDOW_SUBSTR = "HamsterStore"   # substring to match in the window title
OUT_PATH = "scripts/gui_smoke.png"
SW_RESTORE = 9
PW_RENDERFULLCONTENT = 0x00000002


def find_hwnd(substr):
    found = []
    def cb(hwnd, _l):
        n = user32.GetWindowTextLengthW(hwnd)
        if n > 0:
            buf = ctypes.create_unicode_buffer(n + 1)
            user32.GetWindowTextW(hwnd, buf, n + 1)
            if substr in buf.value:
                found.append((hwnd, buf.value))
        return 1
    user32.EnumWindows(ctypes.WINFUNCTYPE(ctypes.c_int, ctypes.c_int, ctypes.c_void_p)(cb), None)
    return found[0][0] if found else None


def capture_png(hwnd, path):
    class RECT(ctypes.Structure):
        _fields_ = [("L", ctypes.c_long), ("T", ctypes.c_long),
                    ("R", ctypes.c_long), ("B", ctypes.c_long)]

    # Restore from minimized/off-screen state first
    user32.ShowWindow(hwnd, SW_RESTORE)
    kernel32.Sleep(300)  # let app redraw
    user32.SetForegroundWindow(hwnd)
    kernel32.Sleep(100)

    r = RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    w = r.R - r.L
    h = r.B - r.T
    if w <= 0 or h <= 0:
        raise SystemExit("window rect is %dx%d — app may be minimized; launch NORMAL" % (w, h))

    hdc = user32.GetWindowDC(hwnd)
    memdc = gdi32.CreateCompatibleDC(hdc)
    bmp = gdi32.CreateCompatibleBitmap(hdc, w, h)
    old_bm = gdi32.SelectObject(memdc, bmp)

    # PW_RENDERFULLCONTENT for off-screen/minimized windows
    user32.PrintWindow(hwnd, memdc, PW_RENDERFULLCONTENT)

    class BMIH(ctypes.Structure):
        _fields_ = [("biSize", ctypes.c_uint32), ("biWidth", ctypes.c_int32),
                    ("biHeight", ctypes.c_int32), ("biPlanes", ctypes.c_uint16),
                    ("biBitCount", ctypes.c_uint16), ("biCompression", ctypes.c_uint32),
                    ("biSizeImage", ctypes.c_uint32), ("biXPelsPerMeter", ctypes.c_int32),
                    ("biYPelsPerMeter", ctypes.c_int32), ("biClrUsed", ctypes.c_uint32),
                    ("biClrImportant", ctypes.c_uint32)]

    bih = BMIH(biSize=ctypes.sizeof(BMIH), biWidth=w, biHeight=-h,
               biPlanes=1, biBitCount=32, biCompression=0)
    buf = ctypes.create_string_buffer(w * h * 4)
    ret = gdi32.GetDIBits(memdc, bmp, 0, h, buf, ctypes.byref(bih), 0)
    if ret == 0:
        raise SystemExit("GetDIBits failed")

    # Access as c_ubyte array — direct bytes indexing returns bytes, not int
    ubyte_arr = (ctypes.c_ubyte * (w * h * 4)).from_buffer(buf)

    # BGRA -> RGBA -> PNG rows (top-down)
    stride = w * 4
    rows = b""
    for y in range(h):
        line = bytearray([0])  # filter byte: none
        for x in range(w):
            i = (y * w + x) * 4
            r_val = ubyte_arr[i]
            g_val = ubyte_arr[i + 1]
            b_val = ubyte_arr[i + 2]
            # a_val = ubyte_arr[i + 3]  # drop alpha for 24-bit
            line += bytes((r_val, g_val, b_val))
        rows += line

    def chunk(typ, data):
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    png = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(rows, 6)) + chunk(b"IEND", b"")

    with open(path, "wb") as f:
        f.write(png)

    gdi32.SelectObject(memdc, old_bm)
    gdi32.DeleteObject(bmp)
    gdi32.DeleteDC(memdc)
    user32.ReleaseDC(hwnd, hdc)
    return w, h


if __name__ == "__main__":
    hwnd = find_hwnd(WINDOW_SUBSTR)
    if not hwnd:
        raise SystemExit("window not found (is the app running & not minimized?)")
    w, h = capture_png(hwnd, OUT_PATH)
    print("captured", OUT_PATH, w, "x", h)
