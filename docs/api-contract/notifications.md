---
module: push_notification
generated_from: docs/api-contract/generated/modules/push_notification.json
generated_hash: sha256-11629d88b89935d3915e3cdd3eaa8578fbb3fd0432a7be3e104be1beb4d4aa11
ledger_schema: 1
last_reviewed: 2026-05-11
---

# 通知契约

> 审查来源: `synapse-rust/src/web/routes/push_notification.rs`

## 模块概述

通知模块负责 Matrix 客户端的通知历史查询以及通知确认（ACK）。

注意：由于 codegen 别名配置，本模块的 SDK 生成代码位于 `push_notification` 命名空间下。

## 真实后端路由

| 方法 | 路径                                                          | 说明         | 认证 |
| ---- | ------------------------------------------------------------- | ------------ | ---- |
| GET  | `/_matrix/client/v3/notifications`                            | 获取通知历史 | 用户 |
| POST | `/_matrix/client/v3/notifications/{notification_id}/ack`      | 确认通知     | 用户 |

## 端点详情

### 1. 获取通知列表

**路径**: `GET /_matrix/client/v3/notifications`  
**认证**: 用户认证

**查询参数**:
- `from` (string, optional): 分页起始位置
- `limit` (number, optional): 返回数量限制
- `only` (string, optional): 过滤条件，如 "highlight"

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

| 端点                               | SDK Manager           | 方法                   | 状态      |
| ---------------------------------- | --------------------- | ---------------------- | --------- |
| `GET /notifications`               | `NotificationsManager` | `getNotifications()`   | ✅ 已封装 |
| `POST /notifications/{id}/ack`     | `NotificationsManager` | `ackNotification()`    | ✅ 已封装 |

## 覆盖率口径

- **后端 Ledger 路由数**: 2
- **SDK 已封装路由数**: 2
- **已绑定生成路由模板**: 2
- **契约覆盖率**: 100%

## 代码定位

- 后端实现: `synapse-rust/src/web/routes/push_notification.rs`
- SDK 实现: `src/notifications/index.ts`
- 生成代码: `src/notifications/__generated__/`
