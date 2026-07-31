# 自定义改动补丁

本目录存放对上游 `QuantumNous/new-api` 的本地自定义改动备份，用于合并上游后快速恢复或重放。

## 📖 完整文档

**改动明细、合并流程、冲突处理全部见 [`自定义改动合并手册.md`](./自定义改动合并手册.md)**（本目录内）

本机另有一份同步副本在仓库外一层：`D:\2api-codes\newapi\自定义改动合并手册.md`。

本 README 只说明本目录的文件结构。

## 一句话背景

渠道配置 `model_mapping` 时，日志与 API 响应体都只暴露用户请求的模型名，不泄露映射后的真实上游模型（`upstream_model_name`）。共 10 处改动 / 8 个文件，全部带 `CUSTOM` 注释标记，**从不提交到 git**，永远以工作区未提交状态存在。

快速校验标记是否还在（预期 `1 2 2 1 1 4 1 2`）：

```bash
grep -c CUSTOM \
  service/log_info_generate.go service/task_billing.go controller/relay.go \
  common/model_mask.go service/http.go relay/helper/common.go \
  web/src/features/usage-logs/lib/format.ts \
  web/src/features/usage-logs/components/dialogs/details-dialog.tsx
```

## 目录结构

| 路径 | 说明 |
|---|---|
| `backup-<时间戳>/` | 每次合并上游前的备份，见下表 |
| `hide-actual-model.patch` | 最早期只含功能一（日志脱敏）的补丁，基线很旧，**仅作参考**。恢复请用最新 `backup-*/`。 |

### `backup-<时间戳>/` 内容

| 文件 | 说明 |
|---|---|
| `base-commit.txt` | 合并**前**的上游基线 commit |
| `merged-to-commit.txt` | 合并**后**的 commit |
| `local-changes.patch` | 自定义改动 diff（**不含**新增文件内容） |
| `local-changes-binary.patch` | 同上，binary 格式 |
| `model_mask.go.bak` | `common/model_mask.go` 完整副本 —— 新增文件不在 diff 里，必须单独备份 |
| `superseded-docs/` | 已被合并手册取代的旧文档存档（仅 `backup-20260731-205313/` 有） |

## 用 patch 重放

```bash
BK=custom-patches/backup-20260731-205313      # 换成最新的
git apply --3way "$BK/local-changes.patch"
cp "$BK/model_mask.go.bak" common/model_mask.go
```

若因上游改动 patch 打不上，按手册「三、改动明细」里的 10 处逐个手动重做。
