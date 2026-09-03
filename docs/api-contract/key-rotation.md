---
module: key_rotation
generated_from: docs/api-contract/generated/modules/key_rotation.json
generated_hash: sha256-7c2a021d71a614166fbd1735073c0b12d8cf72982454dd6fb91342f4e5c0a437
ledger_schema: 1
last_reviewed: 2026-05-26
---

# Key Rotation API 契约文档

> 后端代码: `synapse-rust/src/web/routes/key_rotation.rs`
> 装配入口: `synapse-rust/src/web/routes/assembly.rs`
> 更新日期: 2026-05-26
> 挂载版本: `v1`

## 一、模块概述

### 1.1 功能描述

Key Rotation API 提供端到端加密密钥轮换功能，用于：

- 定期轮换加密密钥以提高安全性
- 查询密钥轮换状态和历史
- 撤销已泄露的密钥
- 配置自动轮换策略

### 1.2 路由前缀

- `/_matrix/client/v1/keys/rotation/*`

### 1.3 认证要求

- 所有端点需要 `AuthenticatedUser`
- 部分端点（轮换、吊销、配置）需要 `is_admin` 权限

## 二、端点详情

### 2.1 查询密钥轮换状态

**路径**: `GET /_matrix/client/v1/keys/rotation/status`
**认证**: `AuthenticatedUser`（需要 admin）
**挂载版本**: `v1`

**响应**: `200 OK`

```typescript
interface KeyRotationStatus {
    /** 是否启用轮换（来自 rotation_status.rotation_enabled） */
    enabled: boolean;
    /** 完整的轮换状态对象（由 rotation_manager.get_rotation_status() 返回） */
    status: Record<string, unknown>;
    /** 用户上次轮换时间戳（毫秒），无记录时为 null */
    user_last_rotation: number | null;
}
```

### 2.2 执行密钥轮换

**路径**: `POST /_matrix/client/v1/keys/rotation/rotate`
**认证**: `AuthenticatedUser`（需要 admin）
**挂载版本**: `v1`

**请求体**:

```json
{
    "key_id": "optional_specific_key_id"
}
```

| 字段     | 类型   | 必填 | 说明                |
| -------- | ------ | ---- | ------------------- |
| `key_id` | string | 否   | 指定要轮换的密钥 ID |

**响应**: `200 OK`

```typescript
interface RotateKeyResponse {
    /** 操作是否成功 */
    success: boolean;
    /** 结果描述信息 */
    message: string;
    /** 是否产生了新密钥 */
    has_new_key: boolean;
}
```

### 2.3 查询密钥轮换历史

**路径**: `GET /_matrix/client/v1/keys/rotation/history/{device_id}`
**认证**: `AuthenticatedUser`
**挂载版本**: `v1`

**路径参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| `device_id` | string | 设备 ID |

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `limit` | integer | 否 | 返回数量限制（默认 10） |
| `from` | string | 否 | 分页起始 token |

**响应**: `200 OK`

```typescript
interface KeyRotationHistoryEntry {
    /** 轮换后的新密钥 ID，数据库无记录时为 null */
    key_id: string | null;
    /** 轮换时间戳（毫秒），数据库无记录时为 null */
    rotated_ts: number | null;
}

interface KeyRotationHistory {
    /** 设备 ID */
    device_id: string;
    /** 轮换记录列表 */
    rotations: KeyRotationHistoryEntry[];
}
```

### 2.4 撤销密钥

**路径**: `POST /_matrix/client/v1/keys/rotation/revoke`
**认证**: `AuthenticatedUser`（需要 admin）
**挂载版本**: `v1`

**请求体**:

```json
{
    "key_id": "key_v1_old123",
    "reason": "compromised"
}
```

| 字段     | 类型   | 必填 | 说明            |
| -------- | ------ | ---- | --------------- |
| `key_id` | string | 是   | 要撤销的密钥 ID |
| `reason` | string | 否   | 撤销原因        |

**响应**: `200 OK`

```typescript
interface RevokeKeyResponse {
    /** 操作是否成功 */
    success: boolean;
    /** 被撤销的密钥数量 */
    revoked: number;
    /** 结果描述信息 */
    message: string;
}
```

### 2.5 配置轮换策略

**路径**: `PUT /_matrix/client/v1/keys/rotation/config`
**认证**: `AuthenticatedUser`（需要 admin）
**挂载版本**: `v1`

**请求体**:

```json
{
    "enabled": true,
    "interval_ms": 2592000000
}
```

| 字段          | 类型    | 必填 | 说明             |
| ------------- | ------- | ---- | ---------------- |
| `enabled`     | boolean | 否   | 是否启用自动轮换 |
| `interval_ms` | integer | 否   | 轮换间隔（毫秒） |

**响应**: `200 OK`

```typescript
interface UpdateRotationConfigResponse {
    /** 当前是否启用自动轮换 */
    enabled: boolean;
    /** 当前轮换间隔（毫秒） */
    interval_ms: number;
}
```

### 2.6 检查是否需要轮换

**路径**: `GET /_matrix/client/v1/keys/rotation/check`
**认证**: `AuthenticatedUser`
**挂载版本**: `v1`

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `key_id` | string | 否 | 要检查的特定密钥 ID |

**响应**: `200 OK`

```typescript
interface KeyCheckResponse {
    /** 是否需要轮换 */
    needs_rotation: boolean;
    /** 上次轮换时间戳（毫秒），无记录时为 null */
    last_rotation: number | null;
    /** 配置的轮换间隔（毫秒） */
    interval_ms: number;
}
```

## 三、SDK 对齐状态

### 3.1 SDK Manager 对应关系

| 后端端点                            | SDK 方法                                  | 状态      |
| ----------------------------------- | ----------------------------------------- | --------- |
| `GET /rotation/status`              | `keyRotationManager.getStatus()`          | ✅ 已封装 |
| `POST /rotation/rotate`             | `keyRotationManager.rotateKey()`          | ✅ 已封装 |
| `GET /rotation/history/{device_id}` | `keyRotationManager.getRotationHistory()` | ✅ 已封装 |
| `POST /rotation/revoke`             | `keyRotationManager.revokeKey()`          | ✅ 已封装 |
| `PUT /rotation/config`              | `keyRotationManager.updateConfig()`       | ✅ 已封装 |
| `GET /rotation/check`               | `keyRotationManager.checkKeyValidity()`   | ✅ 已封装 |

### 3.2 封装覆盖率

- **总端点数**: 6
- **已封装**: 6
- **覆盖率**: 100%

### 3.3 已知差异

- SDK 已提供 `KeyRotationManager`，覆盖状态查询、轮换、历史查询、撤销、策略更新与有效性检查
- `getStatus()` 带有短 TTL 的本地缓存，写操作后会主动失效，减少重复请求
- 后端同时提供 POST 变体用于 `status`、`config`、`check` 端点（SDK 未封装 POST 变体）

## 四、常见错误码

| 状态码 | 错误码             | 说明         |
| ------ | ------------------ | ------------ |
| 400    | `M_INVALID_PARAM`  | 参数无效     |
| 401    | `M_UNAUTHORIZED`   | 未认证       |
| 403    | `M_FORBIDDEN`      | 无权限操作   |
| 404    | `M_NOT_FOUND`      | 密钥不存在   |
| 429    | `M_LIMIT_EXCEEDED` | 轮换频率过高 |

## 五、变更历史

| 日期       | 变更                                             | 影响                        |
| ---------- | ------------------------------------------------ | --------------------------- |
| 2026-04-27 | 初版                                             | -                           |
| 2026-04-27 | 新增 `KeyRotationManager` SDK 封装并补齐单元测试 | SDK 封装覆盖率提升至 100%   |
| 2026-05-26 | 修正类型定义以对齐后端实际响应                   | 修正所有端点的请求/响应类型 |
