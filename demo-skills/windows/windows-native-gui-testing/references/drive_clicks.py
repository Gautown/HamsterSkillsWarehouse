"""Drive a native Windows GUI app via BM_CLICK messages for smoke testing.

Lets you click through every page without computer_use. Liveness check is the
crash signal: a native GUI that stack-overflows dies on a specific navigation.

Session notes (2026-09-01):
- SetForegroundWindow can fail silently if another app (CorelDRAW, Edge) steals
  focus immediately. After SetForegroundWindow, call GetForegroundWindow to
  verify the target is actually active; if not, retry after a short Sleep.
- For Perry TS apps, nav buttons use pattern [LETTER] — match with re.
- EnumChildWindows only finds immediate children; nested widgets need recursive
  enumeration. The callback MUST use ctypes.WINFUNCTYPE or it crashes on
  the second window call.
- perry GUI windows may start off-screen (rect=-32000,-32000). Always call
  ShowWindow(hwnd, SW_RESTORE) before any interaction.
- Python -c one-liners with Chinese characters in window titles can hit
  encoding issues in PowerShell. Use a .py file instead.
"""
import ctypes, time, subprocess, re, sys

user32 = ctypes.windll.user32
BM_CLICK = 0x00F5
WM_CLOSE = 0x0010
SW_RESTORE = 9
SW_SHOWNA = 8

WINDOW_SUBSTR = "HamsterStore"
EXE_NAME = "HamsterStore-GUI.exe"


def find_hwnd_by_pid(pid):
    """Find window by process ID (more reliable than title matching)."""
    def cb(hwnd, lparam):
        proc_id = ctypes.wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(proc_id))
        if proc_id.value == lparam:
            buf = ctypes.create_unicode_buffer(256)
            user32.GetWindowTextW(hwnd, buf, 256)
            return hwnd  # stop enum
        return 1
    result = ctypes.wintypes.HWND()
    win_type = ctypes.WINFUNCTYPE(ctypes.c_int, ctypes.wintypes.HWND, ctypes.c_void_p)
    user32.EnumWindows(win_type(cb), pid)
    return result.value if hasattr(result, 'value') else None


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


def bring_to_front(hwnd):
    """Restore and set foreground, return True if successful."""
    user32.ShowWindow(hwnd, SW_RESTORE)
    ctypes.windll.kernel32.Sleep(200)
    user32.SetForegroundWindow(hwnd)
    ctypes.windll.kernel32.Sleep(300)
    fg = user32.GetForegroundWindow()
    return fg == hwnd


def children_recursive(hwnd):
    """Recursively enumerate all child windows with text.
    
    Returns list of (hwnd, text, class_name).
    NOTE: Must use ctypes.WINFUNCTYPE for the callback or Win32 ABI will crash.
    """
    out = []
    def cb(child_hwnd, _l):
        n = user32.GetWindowTextLengthW(child_hwnd)
        if n > 0:
            b = ctypes.create_unicode_buffer(n + 1)
            user32.GetWindowTextW(child_hwnd, b, n + 1)
            cls = ctypes.create_unicode_buffer(256)
            user32.GetClassNameW(child_hwnd, cls, 256)
            out.append((child_hwnd, b.value, cls.value))
        # Recurse into children
        child_cb = ctypes.WINFUNCTYPE(ctypes.c_int, ctypes.c_int, ctypes.c_void_p)(cb)
        user32.EnumChildWindows(child_hwnd, child_cb, 0)
        return 1
    win_type = ctypes.WINFUNCTYPE(ctypes.c_int, ctypes.c_int, ctypes.c_void_p)
    user32.EnumChildWindows(hwnd, win_type(cb), 0)
    return out


def alive(exe):
    out = subprocess.run('tasklist /fi "imagename eq %s"' % exe,
                         shell=True, capture_output=True).stdout
    return exe.encode() in out  # Use bytes to avoid encoding issues


def click_child(hwnd, label_pattern):
    """Click first child button matching label_pattern, return True if clicked."""
    for c, t, cls in children_recursive(hwnd):
        if cls == "Button" and re.search(label_pattern, t):
            user32.PostMessageW(c, BM_CLICK, 0, 0)
            return True
    return False


if __name__ == "__main__":
    # Try PID-based lookup first (more reliable than title match)
    import os
    pid = None
    result = subprocess.run('wmic process where "name=\'%s\'" get ProcessId' % EXE_NAME,
                            shell=True, capture_output=True, text=True)
    for line in result.stdout.strip().split('\n'):
        line = line.strip()
        if line and line != 'ProcessId':
            try:
                pid = int(line)
                break
            except ValueError:
                pass

    if pid:
        hwnd = ctypes.wintypes.HWND()
        def cb(hwnd_val, lparam):
            proc_id = ctypes.wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd_val, ctypes.byref(proc_id))
            if proc_id.value == lparam:
                ctypes.wintypes.HWND.__setattr__(hwnd, 'value', hwnd_val)
                return 0
            return 1
        win_type = ctypes.WINFUNCTYPE(ctypes.c_int, ctypes.wintypes.HWND, ctypes.c_void_p)
        user32.EnumWindows(win_type(cb), pid)
        if hwnd.value:
            print(f"Found by PID {pid}: hwnd=0x{hwnd.value:X}")
            hwnd = hwnd.value
        else:
            hwnd = find_hwnd(WINDOW_SUBSTR)
    else:
        hwnd = find_hwnd(WINDOW_SUBSTR)

    if not hwnd:
        print("ERROR: app not running", file=sys.stderr)
        sys.exit(1)

    print("hwnd=0x%X" % hwnd)
    print("alive before:", alive(EXE_NAME))

    if not bring_to_front(hwnd):
        print("WARNING: could not bring to foreground")

    # Click nav items matching [LETTER] pattern
    nav_items = ["下载管理", "去重报告", "首页", "软件库", "已安装", "分类"]
    for item in nav_items:
        if click_child(hwnd, re.escape(item)):
            time.sleep(0.5)
            is_alive = alive(EXE_NAME)
            print(f"  clicked '{item}' -> alive={is_alive}")
            if not is_alive:
                print(f"CRASHED after clicking '{item}'")
                sys.exit(1)

    print("final alive:", alive(EXE_NAME))
    user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)
    time.sleep(1)
    print("alive after close:", alive(EXE_NAME))
