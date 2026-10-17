---
module: push_notification
generated_from: docs/api-contract/generated/modules/push_notification.json
generated_hash: sha256-4543ccc64600b30467860ac03cbc6c2c99d0605917f3c8579a3cbc2bac0e3752
ledger_schema: 4
last_reviewed: 2026-05-11
---

# 通知契约

> 审查来源: `synapse-rust/synapse-web/src/routes/push_notification.rs`

## 模块概述

通知模块负责 Matrix 客户端的通知历史查询以及通知确认（ACK）。

注意：由于 codegen 别名配置，本模块的 SDK 生成代码位于 `push_notification` 命名空间下。

## 真实后端路由

| 方法 | 路径                                                     | 说明         | 认证 |
| ---- | -------------------------------------------------------- | ------------ | ---- |
| GET  | `/_matrix/client/v3/notifications`                       | 获取通知历史 | 用户 |
| POST | `/_matrix/client/v3/notifications/{notification_id}/ack` | 确认通知     | 用户 |

## 端点详情

### 1. 获取通知列表

**路径**: `GET /_matrix/client/v3/notifications`  
**认证**: 用户认证

**查询参数**:

- `limit` (number, optional): 返回数量限制，默认 `100`；仅此一个参数被后端识别，`from`、`only` 传入后无效

**响应体 (INotificationsResponse)**:

```typescript
export interface INotificationsResponse {
    next_token?: string;
    notifications: Array<{
        actions: unknown[];
        event: Record<string, unknown>;
        profile_tag?: string;
        read: boolean;
        room_id: string;
        ts: number;
    }>;
}
```

### 2. 确认通知

**路径**: `POST /_matrix/client/v3/notifications/{notification_id}/ack`  
**认证**: 用户认证

**响应**: `200 OK` (空对象)

## SDK 对齐状态

| 端点                           | SDK Manager            | 方法                 | 状态      |
| ------------------------------ | ---------------------- | -------------------- | --------- |
| `GET /notifications`           | `NotificationsManager` | `getNotifications()` | ✅ 已封装 |
| `POST /notifications/{id}/ack` | `NotificationsManager` | `ackNotification()`  | ✅ 已封装 |

## 覆盖率口径

- **后端 Ledger 路由数**: 2
- **SDK 已封装路由数**: 2
- **已绑定生成路由模板**: 2
- **契约覆盖率**: 100%

## 代码定位

- 后端实现: `synapse-rust/synapse-web/src/routes/push_notification.rs`
- SDK 实现: `src/notifications/index.ts`
- 生成代码: `src/notifications/__generated__/`

## 实现口径补充（2026-10-17 后端契约回灌）

### 查询参数

- `GET /notifications` 只识别 `limit`，默认 `100`。`from`、`only` 等 Matrix 标准参数不会被读取，传入也不会改变结果。

### 响应形状

- 顶层为 `{ "notifications": [...], "next_token": null }`。
- 每个列表项是平铺对象，字段为 `notification_id`、`event_id`、`room_id`、`ts`、`profile_tag`、`notification_type`、`read`；不存在标准 Matrix 的 `actions` / 嵌套 `event`。
- `profile_tag` 与 `notification_type` 是并列的两个键：前者是命中的推送规则 tag，后者是通知类型，不能互相替代。

### 分页

- `next_token` 恒为 `null`，该端点不做分页；`notifications` 就是最近 `limit` 条。不要写 `while (next_token)` 的翻页循环。

### ack 响应

- `POST /notifications/{notification_id}/ack` 返回 `{ "notification_id", "is_read", "updated_ts" }`，不是空对象。
- 通知不属于当前用户（含不存在）时返回 `404` `M_NOT_FOUND`。
