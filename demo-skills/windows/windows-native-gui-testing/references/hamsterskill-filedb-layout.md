# HamsterStore FileDB 数据布局

## 数据库路径

- **应用数据目录**: `~/.hamsterstore/`（Windows: `C:\Users\<user>\.hamsterstore\`）
- **FileDB 存储目录**: `~/.hamsterstore/filedb/`
- **不直接写** `store.db` 文件（`Database.ts` 路径解析用 `store.db` 作为逻辑名，
  实际存到 `filedb/` 子目录）

## 表文件

每个 SQLite 表对应一个 JSON 文件：

| 文件 | 内容 |
|------|------|
| `packages.json` | 软件包列表（主数据） |
| `sources.json` | 种子仓库列表 |
| `dedup_map.json` | 去重映射（运行清理后生成） |
| `download_tasks.json` | 下载任务历史 |
| `installations.json` | 安装记录 |
| `source_entries.json` | 种子条目 |
| `settings.json` | 应用设置 |

## Package 模型

顶层字段：`id`, `source_id`, `name`, `version`, `description`, `categories`, `url_hash`, `extra_json`

**重要**: `download_url`, `project_url`, `platform_assets`, `data_source` 不在顶层，
在 `extra_json` 里。通过 `PackageRepository.hydratePackage()` 展开：

```typescript
// hydratePackage() 在 src/data/repositories/PackageRepository.ts:100
// 把 extra_json 展开到顶层，所以 UI 层可以直接访问 pkg.download_url
const ej = JSON.parse(row.extra_json);
return Object.assign({}, row, {
    project_url: ej.project_url,
    download_url: ej.download_url,
    platform_assets: ej.platform_assets,
});
```

**UI 代码中可以直接用 `pkg.download_url`**，不需要自己 parse `extra_json`。

## FileDB 实现

`FileDB.ts` 实现了一个 SQL-like 层，支持：
- `INSERT INTO ... VALUES (...)` → 追加 JSON 行
- `SELECT * FROM ... WHERE ... ORDER BY ...` → 过滤 + 排序
- `UPDATE ... SET ... WHERE ...` → 匹配行更新
- `DELETE FROM ...` → 按 id 过滤删除

**限制**：WHERE 只支持 `AND` 连接的简单 `=` 比较，不支持 JOIN、子查询等。

## 数据量参考

- 基准数据：131 个 packages（来自 builtin-awesome 种子）
- 所有 url_hash 唯一 → 无精确重复
- 所有名称 token 不重叠（都是 `owner/repo` 格式）→ 无模糊候选
