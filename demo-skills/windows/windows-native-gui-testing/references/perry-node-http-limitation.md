# Perry Node.js HTTP 限制 (v0.5.1220)

perry v0.5.1220 的 Node.js `http` 模块有链接器限制：

## 现象

```typescript
// 编译通过（perry check ✅），但 build:gui 失败：
import * as http from "node:http";
http.get(url, ...) // ❌ error TS2304: Cannot find name 'http'
                  // 或链接器错误：js_http_get_overload undefined
```

```typescript
import http from "http";
http.get(...)      // ❌ 同样 linker error
```

```typescript
const http = require("http");
http.get(...)      // ❌ U006: require() banned / js_http_get_overload undefined
```

根因：perry 编译器不实现 `node:http` 模块的 `http.get` overload（符号 `js_http_get_overload` 未定义）。

## 解决方案

改用 **curl spawn** 替代 Node.js http 模块下载：

```typescript
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";

function download(url: string, dest: string, onProgress?: (pct: number) => void) {
    const dir = existsSync(dest) ? dest : mkdirSync(dest, { recursive: true });
    const file = `${dir}/${uuid()}.tmp`;
    return new Promise<{ file: string; task: any }>((resolve, reject) => {
        const child = spawn("curl", ["-L", "--progress-bar", "-o", file, url], {
            shell: true, stdio: ["ignore", "pipe", "pipe"]
        });
        let stdout = "";
        child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
        child.stderr.on("data", (d: Buffer) => { /* progress output */ });
        child.on("close", (code) => {
            if (code === 0) resolve({ file, task: child });
            else reject(new Error(`curl exited ${code}`));
        });
    });
}
```

curl 的 `--progress-bar` 输出进度到 stderr/stdout，可解析百分比。

## 相关

- Perry 无 Web Worker，无法跑浏览器级 fetch
- Perry 的 `spawn` 只支持系统 PATH 里的命令（curl 在 PATH 里）
- 并发控制需在 JS 侧用队列（active < max 时入队）
