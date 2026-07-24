---
module: moderation
generated_from: docs/api-contract/generated/modules/moderation.json
generated_hash: sha256-ddbefeae0ec8631507c56e0ca531bfd3c2a31a79b2cc7d96a06b4f20a2c7cdeb
ledger_schema: 1
last_reviewed: 2026-05-03
---

# Moderation API 契约文档

> 后端代码: `synapse-rust/src/web/routes/moderation.rs`  
> 装配入口: `synapse-rust/src/web/routes/assembly.rs`  
> 更新日期: 2026-04-27  
> 挂载版本: `r0`, `v1`, `v3`

## 一、模块概述

### 1.1 功能描述

Moderation API 提供内容审核功能，用于：

- 举报不当内容或行为
- 对举报内容进行评分
- 查询扫描器信息（v1 专属）
- 房间级举报（v3 专属）

### 1.2 路由前缀

- `/_matrix/client/{r0,v1,v3}/rooms/{room_id}/report/{event_id}`
- `/_matrix/client/v3/rooms/{room_id}/report`

### 1.3 认证要求

- 所有端点需要 `AuthenticatedUser`
- 需要房间成员权限

## 二、端点详情

### 2.1 举报事件

**路径**: `POST /_matrix/client/{r0,v1,v3}/rooms/{room_id}/report/{event_id}`  
**认证**: `AuthenticatedUser` + 房间成员  
**挂载版本**: `r0`, `v1`, `v3`

**路径参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| `room_id` | string | 房间 ID |
| `event_id` | string | 要举报的事件 ID |

**请求体**:

```json
{
    "score": -100,
    "reason": "spam"
}
```

**字段说明**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `score` | integer | 否 | 严重程度评分（-100 到 0） |
| `reason` | string | 否 | 举报原因 |

**响应**: `200 OK`

```json
{}
```

### 2.2 对举报评分

**路径**: `PUT /_matrix/client/{r0,v1,v3}/rooms/{room_id}/report/{event_id}/score`  
**认证**: `AuthenticatedUser` + 房间成员  
**挂载版本**: `r0`, `v1`, `v3`

**请求体**:

```json
{
    "score": -50
}
```

**响应**: `200 OK`

```json
{}
```

### 2.3 查询扫描器信息（v1 专属）

**路径**: `GET /_matrix/client/v1/rooms/{room_id}/report/{event_id}/scanner_info`  
**认证**: `AuthenticatedUser` + 房间成员  
**挂载版本**: `v1`

**响应**: `200 OK`

```typescript
interface ScannerInfo {
    scanner_id: string;
    scan_result: string;
    confidence: number;
    scanned_at: number;
}
```

### 2.4 房间级举报（v3 专属）

**路径**: `POST /_matrix/client/v3/rooms/{room_id}/report`  
**认证**: `AuthenticatedUser`  
**挂载版本**: `v3`

**请求体**:

```json
{
    "reason": "inappropriate_content",
    "description": "This room contains spam"
}
```

**响应**: `200 OK`

```json
{
    "report_id": "report_abc123"
}
```

## 三、SDK 对齐状态

### 3.1 SDK Manager 对应关系

| 后端端点                              | SDK 方法                             | 状态      |
| ------------------------------------- | ------------------------------------ | --------- |
| `POST /report/{event_id}`             | `ModerationManager.reportEvent()`    | ✅ 已封装 |
| `PUT /report/{event_id}/score`        | `ReportingManager.scoreReport()`     | ✅ 已封装 |
| `GET /report/{event_id}/scanner_info` | `ModerationManager.getScannerInfo()` | ✅ 已封装 |
| `POST /rooms/{room_id}/report`        | `ModerationManager.reportRoom()`     | ✅ 已封装 |

### 3.2 封装覆盖率

- **总端点数**: 4
- **已封装**: 4
- **覆盖率**: 100%

### 3.3 已知差异

- 文档曾遗漏 `reportRoom()`，当前代码已覆盖全部 4 个端点。

### 3.4 人工 Review 对齐

- `src/moderation/index.ts` 已覆盖事件举报、房间举报、扫描器信息三类端点。
- `src/reporting/index.ts` 覆盖评分更新（`scoreReport`）以及 `reportEvent`/`reportRoom` 便捷方法。
- 当前差异主要在文档口径，非实现缺失。

## 四、常见错误码

| 状态码 | 错误码             | 说明             |
| ------ | ------------------ | ---------------- |
| 400    | `M_INVALID_PARAM`  | 参数无效         |
| 401    | `M_UNAUTHORIZED`   | 未认证           |
| 403    | `M_FORBIDDEN`      | 非房间成员       |
| 404    | `M_NOT_FOUND`      | 事件或房间不存在 |
| 429    | `M_LIMIT_EXCEEDED` | 举报频率过高     |

## 五、变更历史

| 日期       | 变更                               | 影响                     |
| ---------- | ---------------------------------- | ------------------------ |
| 2026-04-27 | 初版                               | -                        |
| 2026-05-11 | 修正文档中遗漏的房间级举报封装状态 | 覆盖率从 75% 更新为 100% |
