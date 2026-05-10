---
module: event_report
generated_from: docs/api-contract/generated/modules/event_report.json
generated_hash: sha256-5f214615a29d1a132986610dc81060017476d993e9b80a334a22c9ba091bf4f6
ledger_schema: 1
last_reviewed: 2026-05-03
---

# Event Report API 契约文档

> 后端代码: `synapse-rust/src/web/routes/event_report.rs`  
> 装配入口: `synapse-rust/src/web/routes/admin/mod.rs`  
> 更新日期: 2026-04-27  
> 挂载版本: `v1` (Admin)

## 一、模块概述

### 1.1 功能描述

Event Report API 提供管理员查看和管理用户举报的功能。

### 1.2 路由前缀

- `/_synapse/admin/v1/event_reports`

### 1.3 认证要求

- 所有端点需要 `AdminUser`

## 二、端点详情

### 2.1 查询所有举报

**路径**: `GET /_synapse/admin/v1/event_reports`  
**认证**: `AdminUser`

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `from` | integer | 否 | 分页起始 |
| `limit` | integer | 否 | 返回数量（默认100） |
| `dir` | string | 否 | 排序方向：`f`/`b` |
| `user_id` | string | 否 | 过滤举报人 |
| `room_id` | string | 否 | 过滤房间 |

**响应**: `200 OK`

```typescript
interface EventReportsResponse {
    event_reports: Array<{
        id: number;
        received_ts: number;
        room_id: string;
        event_id: string;
        user_id: string;
        reason?: string;
        score?: number;
        sender: string;
    }>;
    next_token?: number;
    total: number;
}
```

### 2.2 查询单个举报

**路径**: `GET /_synapse/admin/v1/event_reports/{report_id}`  
**认证**: `AdminUser`

**响应**: `200 OK`

```typescript
interface EventReportDetail {
    id: number;
    received_ts: number;
    room_id: string;
    event_id: string;
    user_id: string;
    reason?: string;
    score?: number;
    sender: string;
    canonical_alias?: string;
    event_json: object;
}
```

### 2.3 删除举报

**路径**: `DELETE /_synapse/admin/v1/event_reports/{report_id}`  
**认证**: `AdminUser`

**响应**: `200 OK`

```json
{}
```

## 三、SDK 对齐状态

### 3.1 SDK Manager 对应关系

| 后端端点                     | SDK 方法 | 状态      |
| ---------------------------- | -------- | --------- |
| `GET /event_reports`         | -        | ❌ 未封装 |
| `GET /event_reports/{id}`    | -        | ❌ 未封装 |
| `DELETE /event_reports/{id}` | -        | ❌ 未封装 |

### 3.2 封装覆盖率

- **总端点数**: 3
- **已封装**: 0
- **覆盖率**: 0%

## 四、变更历史

| 日期       | 变更 | 影响 |
| ---------- | ---- | ---- |
| 2026-04-27 | 初版 | -    |
