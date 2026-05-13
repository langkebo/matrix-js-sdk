---
module: typing
generated_from: docs/api-contract/generated/modules/typing.json
generated_hash: sha256-5935011e2da1332da9230316f8642918542dbf6c92c637fc73578c676ff05ca3
ledger_schema: 1
last_reviewed: 2026-05-03
---

# Typing Indicators API 契约文档

> 后端代码: `synapse-rust/src/web/routes/typing.rs`  
> 装配入口: `synapse-rust/src/web/routes/assembly.rs`  
> 更新日期: 2026-04-27  
> 挂载版本: `v3`

## 一、模块概述

### 1.1 功能描述

Typing Indicators API 提供输入状态指示功能，用于显示"正在输入..."提示。

### 1.2 路由前缀

- `/_matrix/client/v3/rooms/{room_id}/typing/{user_id}`
- `/_matrix/client/v3/rooms/{room_id}/typing`
- `/_matrix/client/v3/rooms/typing`

### 1.3 认证要求

- 需要 `AuthenticatedUser`
- 需要房间成员权限
- 只能更新自己的输入状态

## 二、端点详情

### 2.1 设置用户输入状态

**路径**: `PUT /_matrix/client/v3/rooms/{room_id}/typing/{user_id}`  
**认证**: `AuthenticatedUser` + 房间成员  
**挂载版本**: `v3`

**路径参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| `room_id` | string | 房间 ID |
| `user_id` | string | 用户 ID（必须是当前用户） |

**请求体**:

```json
{
    "typing": true,
    "timeout": 30000
}
```

**字段说明**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `typing` | boolean | 是 | 是否正在输入 |
| `timeout` | integer | 否 | 超时时间（毫秒），默认 30000 |

**响应**: `200 OK`

```json
{}
```

### 2.2 获取房间输入状态

**路径**: `GET /_matrix/client/v3/rooms/{room_id}/typing`  
**认证**: `AuthenticatedUser` + 房间成员  
**挂载版本**: `v3`

**响应**: `200 OK`

```typescript
interface TypingResponse {
    user_ids: string[];
}
```

### 2.3 批量获取输入状态

**路径**: `POST /_matrix/client/v3/rooms/typing`  
**认证**: `AuthenticatedUser`  
**挂载版本**: `v3`

**请求体**:

```json
{
    "room_ids": ["!room1:server", "!room2:server"]
}
```

**响应**: `200 OK`

```typescript
interface BatchTypingResponse {
    rooms: {
        [room_id: string]: {
            user_ids: string[];
        };
    };
}
```

## 三、SDK 对齐状态

### 3.1 SDK Manager 对应关系

| 后端端点                | SDK 方法                        | 状态      |
| ----------------------- | ------------------------------- | --------- |
| `PUT /typing/{user_id}` | `MatrixClient.sendTyping()`     | ✅ 已封装 |
| `GET /typing`           | `MatrixClient.getRoomTyping()`  | ✅ 已封装 |
| `POST /rooms/typing`    | `MatrixClient.getBatchTyping()` | ✅ 已封装 |

### 3.2 封装覆盖率

- **总端点数**: 3
- **已封装**: 3
- **覆盖率**: 100%

### 3.3 已知差异

- `TypingManager` 额外提供 `fetchTypingUsers()`、`fetchUserTyping()`、`fetchRoomsTyping()`，
  用于在本地 `m.typing` 缓存之外直接查询服务端实时状态；请求体和响应字段已对齐
  `room_ids` / `user_ids` 的生成契约。

### 3.4 人工 Review 对齐

- `src/typing/index.ts` 已绑定生成的 `route-table` 路径模式，避免手写路径与 Ledger 漂移。
- 批量查询兼容 `rooms` 包装响应与旧格式裸对象响应，便于平滑过渡历史实现。
- 单元测试已覆盖 `v3` 前缀、`room_ids` 请求体、`user_ids` 响应映射及旧字段回退逻辑。

## 四、常见错误码

| 状态码 | 错误码            | 说明                         |
| ------ | ----------------- | ---------------------------- |
| 400    | `M_INVALID_PARAM` | 参数无效                     |
| 401    | `M_UNAUTHORIZED`  | 未认证                       |
| 403    | `M_FORBIDDEN`     | 非房间成员或尝试更新他人状态 |
| 404    | `M_NOT_FOUND`     | 房间不存在                   |

## 五、变更历史

| 日期       | 变更 | 影响 |
| ---------- | ---- | ---- |
| 2026-04-27 | 初版 | -    |
| 2026-05-11 | 补充 TypingManager 人工封装对齐说明与测试口径 | 文档与实际实现同步 |
