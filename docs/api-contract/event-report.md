---
module: event_report
generated_from: docs/api-contract/generated/modules/event_report.json
generated_hash: sha256-a1b48dcdc8eda7791d9e4e43c4eae736898930eddbc31c11ede9ae820c3b58af
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

Event Report API 提供管理员查看和管理用户举报的功能，覆盖：

- 创建举报
- 按主列表、事件、房间、举报人、状态查询举报
- 举报总数与按状态计数
- 更新、解决、驳回、升级、删除举报
- 查询举报历史、频率限制状态与封禁/解封举报能力

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

### 2.4 创建举报

**路径**: `POST /_synapse/admin/v1/event_reports`

### 2.5 举报总数

**路径**: `GET /_synapse/admin/v1/event_reports/count`

### 2.6 更新举报

**路径**: `PUT /_synapse/admin/v1/event_reports/{report_id}`

### 2.7 解决举报

**路径**: `POST /_synapse/admin/v1/event_reports/{report_id}/resolve`

### 2.8 驳回举报

**路径**: `POST /_synapse/admin/v1/event_reports/{report_id}/dismiss`

### 2.9 升级举报

**路径**: `POST /_synapse/admin/v1/event_reports/{report_id}/escalate`

### 2.10 举报历史

**路径**: `GET /_synapse/admin/v1/event_reports/{report_id}/history`

### 2.11 按事件查询

**路径**: `GET /_synapse/admin/v1/event_reports/event/{event_id}`

### 2.12 按房间查询

**路径**: `GET /_synapse/admin/v1/event_reports/room/{room_id}`

### 2.13 按举报人查询

**路径**: `GET /_synapse/admin/v1/event_reports/reporter/{reporter_id}`

### 2.14 按状态查询

**路径**: `GET /_synapse/admin/v1/event_reports/status/{status}`

### 2.15 状态计数

**路径**: `GET /_synapse/admin/v1/event_reports/status/{status}/count`

### 2.16 统计信息

**路径**: `GET /_synapse/admin/v1/event_reports/stats`

### 2.17 频率限制查询

**路径**: `GET /_synapse/admin/v1/event_reports/rate_limit/{user_id}`

### 2.18 封禁用户

**路径**: `POST /_synapse/admin/v1/event_reports/rate_limit/{user_id}/block`

### 2.19 解封用户

**路径**: `POST /_synapse/admin/v1/event_reports/rate_limit/{user_id}/unblock`

## 三、SDK 对齐状态

### 3.1 SDK Manager 对应关系

| 后端端点                                           | SDK 方法                                    | 状态      |
| -------------------------------------------------- | ------------------------------------------- | --------- |
| `POST /event_reports`                              | `eventReportManager.createReport()`         | ✅ 已封装 |
| `GET /event_reports`                               | `eventReportManager.listReports()`          | ✅ 已封装 |
| `GET /event_reports/count`                         | `eventReportManager.getReportsCount()`      | ✅ 已封装 |
| `GET /event_reports/{id}`                          | `eventReportManager.getReport()`            | ✅ 已封装 |
| `PUT /event_reports/{id}`                          | `eventReportManager.updateReport()`         | ✅ 已封装 |
| `DELETE /event_reports/{id}`                       | `eventReportManager.deleteReport()`         | ✅ 已封装 |
| `POST /event_reports/{id}/resolve`                 | `eventReportManager.resolveReport()`        | ✅ 已封装 |
| `POST /event_reports/{id}/dismiss`                 | `eventReportManager.dismissReport()`        | ✅ 已封装 |
| `POST /event_reports/{id}/escalate`                | `eventReportManager.escalateReport()`       | ✅ 已封装 |
| `GET /event_reports/{id}/history`                  | `eventReportManager.getReportHistory()`     | ✅ 已封装 |
| `GET /event_reports/event/{event_id}`              | `eventReportManager.getReportsByEvent()`    | ✅ 已封装 |
| `GET /event_reports/room/{room_id}`                | `eventReportManager.getReportsByRoom()`     | ✅ 已封装 |
| `GET /event_reports/reporter/{reporter_id}`        | `eventReportManager.getReportsByReporter()` | ✅ 已封装 |
| `GET /event_reports/status/{status}`               | `eventReportManager.getReportsByStatus()`   | ✅ 已封装 |
| `GET /event_reports/status/{status}/count`         | `eventReportManager.getStatusCount()`       | ✅ 已封装 |
| `GET /event_reports/stats`                         | `eventReportManager.getStats()`             | ✅ 已封装 |
| `GET /event_reports/rate_limit/{user_id}`          | `eventReportManager.checkRateLimit()`       | ✅ 已封装 |
| `POST /event_reports/rate_limit/{user_id}/block`   | `eventReportManager.blockUser()`            | ✅ 已封装 |
| `POST /event_reports/rate_limit/{user_id}/unblock` | `eventReportManager.unblockUser()`          | ✅ 已封装 |

### 3.2 封装覆盖率

- **总端点数**: 19
- **已封装**: 19
- **覆盖率**: 100%

### 3.3 人工 Review 收口

- 手写 manager 已绑定 [route-table.ts](file:///Users/ljf/Desktop/hu_ts/matrix-js-sdk/src/event-report/__generated__/route-table.ts)，避免 ledger 扩展后路径继续漂移
- 新增 `count / by-event / by-room / by-reporter / by-status / status-count` 等查询方法
- 新增定向单测 [event-report.spec.ts](file:///Users/ljf/Desktop/hu_ts/matrix-js-sdk/spec/unit/event-report.spec.ts)，覆盖新增端点与参数校验

## 四、变更历史

| 日期       | 变更                                         | 影响                  |
| ---------- | -------------------------------------------- | --------------------- |
| 2026-04-27 | 初版                                         | -                     |
| 2026-05-10 | 补齐 `EventReportManager` 缺失端点并增加单测 | SDK 覆盖率提升至 100% |
