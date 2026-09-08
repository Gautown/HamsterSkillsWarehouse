# Perry 源码副本 vs Git 仓库 分离模式

HamsterStore 等 Perry 项目的典型目录结构：

```
F:/GoghStudio/GitHub/PerryTS/HamsterStore/      ← 源码副本（非 git）
  src/                                            源代码
  dist/HamsterStore-GUI.exe                      perry compile 输出
  package.json / tsconfig.json                   npm 工具链

F:/GoghStudio/GitHub/github/HamsterStore/hamsterstore/  ← 真 git 仓库（main）
  src/                                            与上面对齐
  .git
```

## 同步策略

源码副本是 perry compile 的输入目录，真仓库是 git 操作的目标。两者通过
手动 cp 同步，不是 git worktree 或 symlink。

**每次 commit 前**：
```bash
# 从源码副本复制到真仓库
cp "/f/GoghStudio/GitHub/PerryTS/HamsterStore/src/core/download/DownloadManager.ts" \
   "src/core/download/DownloadManager.ts"
cp "/f/GoghStudio/GitHub/PerryTS/HamsterStore/src/ui/components/DedupReport.ts" \
   "src/ui/components/DedupReport.ts"
# ... 所有变更文件

# 在真仓库操作
cd /f/GoghStudio/GitHub/github/HamsterStore/hamsterstore
git add -A
git commit -m "..."
git push
```

## 为什么这样设计

- Perry 编译器要求一个干净的构建目录，不能在有 `.git` 干扰的路径下工作
- `perry check` 和 `npm run check` 在源码副本上运行
- `npm run build:gui` 在源码副本上构建
- git 操作只在真仓库进行
- attests 里的 `commit_sha` 为空是因为源码副本不是 git repo，这是已知的

## 相关

- Perry 项目的源码副本路径见项目根目录的 `perry.toml` 或构建脚本
- 真仓库路径通常在同级目录下以 `github/` 子目录组织
