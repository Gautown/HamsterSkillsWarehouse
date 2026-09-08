---
name: hamsterstore
category: software-development
description: "HamsterStore项目开发——Perry TS应用、FileDB数据库、同步机制、GUI重构、网络加速器"
---

# HamsterStore 项目开发指南

HamsterStore 是跨平台开源软件仓库管理工具，基于 Perry TS 构建。

## 项目结构

```
F:/GoghStudio/GitHub/PerryTS/HamsterStore/   # 源码副本（工作目录）
F:/GoghStudio/GitHub/github/HamsterStore/hamsterstore/  # Git 仓库（提交目标）
~/.hamsterstore/filedb/                       # FileDB JSON 数据库
```

## Perry v0.5.1220 硬限制

### 1. 正则字面量剥离
Perry bundler 会剥离复杂正则表达式，尤其是包含 `\)` 的模式。

**解决方案**：使用字符串方法替代

### 2. execSync 阻塞
`execSync` 在网络请求时会永久挂起，阻塞单线程事件循环。

**解决方案**：避免使用，改用 spawn + 回调模式

### 3. tree-shaking 过于激进
未直接引用的类和方法可能被完全剥离。

**解决方案**：核心逻辑内联到主函数，避免创建独立类

### 4. FileDB WHERE 查询
FileDB 的 WHERE 解析器非常简单，只支持 `=` 和简单 `LIKE`。

**解决方案**：在 Repository 层直接过滤内存数据，绕过 SQL

### 5. Perry bundler 剥离类方法
核心逻辑内联到主函数或静态方法中，直接访问 `FileDB.tables`。

### 6. this vs self
部分方法使用 `self` 引用，但 Perry 中应使用 `this`。

### 7. 代理加速
- `HamsterProxy.ts`：本地代理封装，使用 spawn curl 模式
- `ProxyManager.ts`：节点测速、故障转移、URL 加速
- StatusBar 显示代理状态（节点名+延迟）

## 同步流程

### 数据源
1. **BUILT_IN_PACKAGES** (144条)：真实种子数据
2. **Seed Repos** (13个)：awesome-* 元数据源

### syncAll() 流程
```typescript
export class SourceSyncer {
    syncAll(): number {
        let ok = 0;
        // 1. 同步 BUILT_IN_PACKAGES
        for (const p of BUILT_IN_PACKAGES) {
            const hash = GitHubAPIClient.urlHash(p.url);
            if (PackageRepository.getByUrlHash(hash)) continue;
            PackageRepository.create({...});
            ok++;
        }
        // 2. 同步 Seed 元数据
        ...
        return ok;
    }
}
```

### 命令
```bash
# 同步
./dist/HamsterStore.exe sync
# 查看列表
./dist/HamsterStore.exe list
# 清除数据库
rm -f ~/.hamsterstore/filedb/*.json
```

## 提交规范

1. 修改源码到 `PerryTS/HamsterStore/`
2. 复制到 git 仓库：
   ```bash
   cp src/xxx.ts /f/GoghStudio/GitHub/github/HamsterStore/hamsterstore/src/
   ```
3. 在 git 仓库提交：
   ```bash
   cd /f/GoghStudio/GitHub/github/HamsterStore/hamsterstore
   git add -A && git commit -m "fix: 描述"
   git push
   ```

## 常用调试

```bash
# 检查 TypeScript
npm run check

# 构建 CLI
npm run build:cli

# 构建 GUI
npm run build:gui

# 清理测试文件
rm -f test_*.ts test_*.js
```

## 数据库位置

- 开发环境：`~/.hamsterstore/filedb/`
- 文件：`packages.json`, `sources.json`

## 当前状态

- 分支：main
- HEAD: 5c0fa58
- 同步数据：143条（131 builtin + 12 seed）
- 描述质量：131条有具体中文描述（92%）
- 搜索功能：正常工作
- 网络搜索：框架已实现（spawn curl 模式）
- 代理加速：框架已实现（节点测速、故障转移）

## 最新提交

```
5c0fa58 feat: 实现 HamsterProxy 网络加速器
983485a feat: 改进下载管理界面
6a8b25f feat: 添加网络搜索框架（受限版）
9137d84 feat: 改进 GUI 交互体验
```

## 关联文档

- [HamsterProxy 网络加速器实现](references/hamster-proxy.md) — 代理架构、测速逻辑、节点配置