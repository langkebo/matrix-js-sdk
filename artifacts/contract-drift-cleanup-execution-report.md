# 合同漂移清理执行报告

> 执行时间：2026-09-18
> 负责人：工作助手

## 1. 任务概述

本次任务聚焦于 SDK 合同漂移的清理工作，目标是：
1. 完成 5 条 stale registry 登记的清理
2. 修复 gate 脚本以正确处理 `{v1,v3}` 前缀归一化
3. 解决 245 条未登记的 r0 client 路由问题（根因 Task #5）
4. 重新生成缺口报告，确保文档与门禁一致

## 2. 已完成工作

### 2.1 stale Registry 登记清理 ✅

**文件**：`scripts/quality/contract-drift-registry.json`

删除 5 条过期登记：
- `cas:sdk-only:GET /_matrix/client/v3/login/sso/redirect/cas`
- `e2ee:sdk-only:GET /_matrix/client/v3/keys/history`
- `e2ee:sdk-only:POST /_matrix/client/v3/keys/upload/{device_id}`
- `push:sdk-only:GET /_matrix/client/v3/pushers/`
- `room:sdk-only:GET /_matrix/client/v3/rooms/{room_id}/anti_screenshot`

**结果**：剩余 6 条有效登记（2 media + 2 room + 2 search），`check-contract-drift` 门禁通过。

### 2.2 Gate 脚本 r0 前缀归一化修复 ✅

**文件**：`scripts/quality/check-sdk-contract-alignment.mjs`

已完成的修复（见前序文档）：
- `isWildcardSegment`：正则匹配 `{xxx}` 通配符
- `normalizePathForMatch`：添加 `m.reaction` 等事件类型字面量归一化
- `parseRustRouterReference`：支持 `.factory()` 调用语法
- `extractRustRoutesFromFunction`：链式 factory 基础检测

**结果**：`[sdk-contract-alignment] ok (43 aligned rows checked, 0 unresolved attributions)`

### 2.3 CodeGen r0 Pruning 根因修复 ✅

**文件**：`scripts/sdk-contract-codegen.mjs`

**新增功能**：
- `countLedgerClientR0Routes()`：统计 ledger 中 client r0 路由数量
- `isClientR0Path()`：判断路径是否为 client r0 前缀
- 在 `render()` 函数中加入 r0 pruning 逻辑：当 ledger 客户端面 r0 条目为 0 时，自动剔除 route-table 中的 r0 client 路由

**剔除统计**：
- auth: 69, room: 47, e2ee: 14, key-backup: 33
- friend: 28, push: 16, verification: 12, notifications: 7, oidc: 7
- 等 22 个模块，累计剔除 296 条 r0 client 路由

**结果**：SDK route-table 从 314 条 r0 降至 0 条（client r0），仅保留 media 模块的合法 r0 路由。

## 3. 门禁验证结果

| 门禁脚本 | 结果 | 说明 |
|---------|------|------|
| `check-sdk-contract-alignment.mjs` | ✅ PASS | 43 条对齐，0  unresolved |
| `check-contract-drift.mjs` | ✅ PASS | 6 条差集已登记，无 stale |
| `sdk-contract-codegen.mjs --check` | ✅ PASS | 47 个模块完备同步 |
| `tsc --noEmit` | ✅ PASS | TypeScript 类型检查通过 |
| `check-manager-codegen-coverage.mjs` | ✅ PASS | 100% 覆盖率 |
| `check-public-jsdoc-examples.mjs` | ✅ PASS | 43 条文档示例通过 |

## 4. 剩余差集说明

6 条登记差集（`contract-drift-registry.json`）：
- media:sdk-only × 2（upload/provider, upload/token）
- room:sdk-only × 2（mutual_rooms v1/v3）
- search:sdk-only × 2（vendor search_recipients, search_rooms）

所有差集均有登记说明，`expires` 均为 2026-12-31。

## 5. 文档更新

### 5.1 已更新的文档

| 文档 | 变更 | 说明 |
|------|------|------|
| `docs/api-contract/moderation.md` | r0 → v1,v3 | 后端无 r0，仅 v1/v3 |
| `docs/api-contract/relations.md` | r0 → v1,v3，参数名修正 | `target_event_id` → `txn_id` |
| `docs/api-contract/reactions.md` | r0 → v3 | 后端 reactions 路由为字面量 `m.reaction` |

### 5.2 重新生成的产出

- `artifacts/sdk-contract-gap-report.md`：更新时间 2026-09-18 17:53:38
- `artifacts/sdk-contract-gap.json`：同步更新

报告显示客户端面漂移已清零：
- L1 声明面：1124 → 834 条（剔除 296 条 r0）
- 漂移：0
- 缺口：0

## 6. 后续建议

### 6.1 待办事项

1. **Task #9**：Tjg 裸调点指标重定义
   - 现象：`authedRequest` 42 处 / `_synapse/` 24 处
   - 建议：将指标从文本匹配改为 "SDK 越层调用点"

2. **后端路径指针清理**（3 处）
   - `synapse-rust/src/web/routes` → `synapse-web/src/routes`
   - 文件：`MatrixRendezvousService.ts`、`paths/moderation.ts`、`voice.contract.test.ts`

3. **Task #10**：语义一致性深度审计
   - 检查 `@langkebo/matrix-js-sdk` 与 Sprint 4 后端语义是否一致
   - 产出 `sdk-encapsulation-audit.md`

### 6.2 维护提醒

- 下次后端 r0 清理后，需运行 `node scripts/sdk-contract-codegen.mjs` 自动剔除对应 route-table 条目
- `check-contract-drift` 会自动检测 r0 client 路由的 stale 问题

---

**执行者**：工作助手 (glm-5.3)
**审核状态**：待用户确认
