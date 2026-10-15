---
module: invite_blocklist
generated_from: docs/api-contract/generated/modules/invite_blocklist.json
generated_hash: sha256-aa08101e9ce3418062a12a68100aa75206d01286e980b07a9c1e7cf076d94bb4
ledger_schema: 4
last_reviewed: 2026-10-15
---

# Invite Blocklist / Allowlist API 契约文档

> 后端代码: `synapse-rust/synapse-web/src/routes/assembly.rs`（注册在核心 router 桶）
> SDK 入口: `src/invite-blocklist/index.ts`
> 更新日期: 2026-10-15
> 挂载版本: `vendor/v1`

## 一、当前审计结论

- `generated/modules/invite_blocklist.json` 当前记录 **4** 条后端路由。本页是 **2026-10-15 新收编**：
  该模块此前在覆盖门禁里挂 WAIVED，理由是「把 invite allow/blocklist 从 vendor 分组归到功能域后，
  codegen 以**后端 `ROUTE_CONTRACT.md` 的章节**枚举模块，而该文档按源文件分组（这几条注册在
  `assembly.rs` 里），没有 invite 章节 ⇒ 暂无可生成的表」。
- **该理由已不成立**（与 `delayed_events` 同型的「登记缺失」）：codegen 的模块枚举源实际是
  **本仓 `CONTRACT_INDEX.md` 的文档链接**，而路由条目另有 **ledger 通道**
  （`LEDGER_MODULE_ALIASES` 早已有 `invite-blocklist → invite_blocklist`）。因此**建页即可收编**，
  无需后端章节映射参与。本页的建立正是「补登记」这一步。
- SDK 已有 `InviteBlocklistManager`，**4 处** HTTP 调用是**字面量相对路径 + `VendorPrefix`**，
  与契约表逐字一致 ⇒ 直接接入 `PathAssert` 编译期断言。

## 二、路由前缀与认证

- `/_matrix/vendor/v1/rooms/{room_id}/invite_blocklist`
- `/_matrix/vendor/v1/rooms/{room_id}/invite_allowlist`
- 全部端点需要 `AuthenticatedUser`（房间级权限由后端校验）

## 三、核心请求与响应形状

阻断列表查询响应：

```typescript
interface IBlocklistResponse {
    blocklist: string[];
    /** 兼容字段（后端部分版本不回） */
    blocked_users?: string[];
}
```

允许列表查询响应：

```typescript
interface IAllowlistResponse {
    allowlist: string[];
    /** 兼容字段（后端部分版本不回） */
    allowed_users?: string[];
}
```

写入（`POST`）在查询响应之上回显 `success`：

```typescript
interface IBlocklistResult {
    success: boolean;
    blocklist: string[];
    blocked_users?: string[];
}
```

```typescript
interface IAllowlistResult {
    success: boolean;
    allowlist: string[];
    allowed_users?: string[];
}
```

## 四、路由与 SDK 对齐表

| 方法 | 路径                                                  | SDK 方法         |
| ---- | ----------------------------------------------------- | ---------------- |
| GET  | `/_matrix/vendor/v1/rooms/{room_id}/invite_blocklist` | `getBlocklist()` |
| POST | `/_matrix/vendor/v1/rooms/{room_id}/invite_blocklist` | `setBlocklist()` |
| GET  | `/_matrix/vendor/v1/rooms/{room_id}/invite_allowlist` | `getAllowlist()` |
| POST | `/_matrix/vendor/v1/rooms/{room_id}/invite_allowlist` | `setAllowlist()` |

## 五、SDK 对齐状态

- **总端点数**: 4
- **已封装**: 4
- **覆盖率**: 100%
- **路径绑定**: `src/invite-blocklist/index.ts` 使用生成的 `InviteBlocklistPath` +
  `PathAssert<…, StripVendor<InviteBlocklistPath>>`（segment 级精确断言）
- **本地增强（不计入契约统计）**: `addToBlocklist` / `removeFromBlocklist` / `clearBlocklist`、
  `isUserBlocked` / `isUserAllowed` 是**基于上述 4 条端点的客户端组合**（读—改—写 + 本地缓存），
  不产生额外后端路由；`getInvitePermissionConfig` / `setInvitePermissionConfig` 走 account data。
- **验证状态**: `spec/unit/invite-blocklist*.spec.ts` + 生成的 `__generated__/acceptance.spec.ts`

## 六、变更历史

| 日期       | 变更                                                                                  | 影响                                 |
| ---------- | ------------------------------------------------------------------------------------- | ------------------------------------ |
| 2026-10-15 | 新收编为 codegen 管辖模块：建页（走 ledger 通道）+ manager 接编译期断言 + 解除 WAIVED | 4 条路由从「无约束」变为受契约表管辖 |
| 2026-04-27 | 初版（`invite-blocklist` 未独立成页，路由散落在 assembly 相关章节）                   | -                                    |
