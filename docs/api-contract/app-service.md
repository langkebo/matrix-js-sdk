---
module: app_service
generated_from: docs/api-contract/generated/modules/app_service.json
generated_hash: sha256-7bcfbe4ef67d6daa3dbb86363caf84ef3179542613d8030b3896052662ea7e33
ledger_schema: 4
last_reviewed: 2026-05-03
---

# Application Service API 契约文档

> 后端代码: `synapse-rust/synapse-web/src/routes/app_service.rs`  
> 装配入口: `synapse-rust/synapse-web/src/routes/assembly.rs`  
> 更新日期: 2026-04-27  
> 挂载版本: `v1`

## 一、模块概述

### 1.1 功能描述

Application Service API 提供应用服务（AS）集成功能，用于桥接和机器人。

### 1.2 路由前缀

- `/_matrix/client/v1/user/{user_id}/appservice`
- `/_matrix/app/v1/*`
- `/_synapse/admin/v1/appservices`

### 1.3 认证要求

- 客户端端点：`AuthenticatedUser`
- AS 端点：AS token
- 管理端点：`AdminUser`

## 二、端点详情

### 2.1 AS Ping

**路径**: `POST /_matrix/app/v1/ping`  
**认证**: AS token

**响应**: `200 OK`

```json
{ "as_id": "<as_id>" }
```

### 2.2 AS 事务

**路径**: `PUT /_matrix/app/v1/transactions/{as_id}/{txn_id}`  
**认证**: AS token

**请求体**:

```json
{
    "events": []
}
```

**响应**: `200 OK`

```json
{}
```

### 2.3 查询 AS 用户

**路径**: `GET /_matrix/app/v1/users/{user_id}`  
**认证**: AS token

**响应**: `200 OK`

```typescript
interface ASUser {
    user_id: string;
    displayname?: string;
    avatar_url?: string;
}
```

### 2.4 查询 AS 房间

**路径**: `GET /_matrix/app/v1/rooms/{alias}`  
**认证**: AS token

**响应**: `200 OK`

```typescript
interface ASRoom {
    room_id: string;
    alias: string;
}
```

### 2.5 管理 AS（Admin）

**路径**: `GET /_synapse/admin/v1/appservices`  
**认证**: `AdminUser`

**响应**: `200 OK`

```typescript
interface AppServicesResponse {
    appservices: Array<{
        id: string;
        url: string;
        sender_localpart: string;
        namespaces: object;
    }>;
}
```

## 三、SDK 对齐状态

### 3.1 封装覆盖率

- **总端点数**: 5
- **已封装**: 0
- **覆盖率**: 0%

## 四、变更历史

| 日期       | 变更 | 影响 |
| ---------- | ---- | ---- |
| 2026-04-27 | 初版 | -    |

## 实现口径补充（2026-10-17 后端契约回灌）

> 本节依据 `synapse-rust/docs/sdk/appservices.md` 回灌。正文的路由表、端点计数、覆盖率与日期保持不变；若正文与本节冲突，以本节为准。

### 回调面的用户与房间查询

- `GET /_matrix/app/v1/users/{user_id}`：命中当前 AS 的 `users` 命名空间返回 `200 {}`，未命中返回 `403 M_FORBIDDEN`（`User not in application service namespace`）。
- `GET /_matrix/app/v1/rooms/{alias}`：命中 `aliases` 命名空间返回 `200 {}`，未命中返回 `403 M_FORBIDDEN`（`Room alias not in application service namespace`）；路径里的 `#` 必须编码为 `%23`。
- `PUT /_matrix/app/v1/transactions/{as_id}/{txn_id}`：`as_token` 对应的 `as_id` 必须与路径一致，否则 `403 M_FORBIDDEN`；成功返回 `{}`。

### 管理面列表与实体字段

- `GET /_synapse/admin/v1/appservices` 返回裸数组 `AppServiceResponse[]`，且只包含 `is_enabled = true` 的 AS。
- `AppServiceResponse` 字段为 `id`（数据库自增数字，不是 `as_id`）、`as_id`、`url`（可为 `null`）、`sender`、`description`、`rate_limited`、`protocols`、`is_enabled`、`created_ts`（毫秒）。
- 正文示例中的 `id: string`、`sender_localpart`、`namespaces` 与后端不符：`id` 是数字，实体字段是 `sender`，列表响应不带 `namespaces`。

### 两类 token 的边界

- `as_token` 由 AS 持有，用于 AS 调用 `/_matrix/app/v1/*` 与 `fed_proxy`，由 homeserver 校验。
- `hs_token` 由 homeserver 持有，用于 homeserver 把请求代理到 AS 时做 `Bearer` 认证，由 AS 校验。
- 两者都不会出现在任何管理响应里；`AppServiceResponse` 不回显 token，注册后只能由提交方自行保存。

### `url: null` 与配置摘要

- `url: null` 是合法注册：该 AS 仍可用 `as_token` 认证、仍可被 `fed_proxy` 识别。
- 但该 AS 没有推送端点：homeserver 不排队事件，`proxy_to_as` 返回 `503`，管理面 `ping` 恒为 `alive: false`。
- `GET /_matrix/app/v1/{as_id}` 返回配置摘要，键名是 `id` 而不是 `as_id`，字段为 `id`、`url`、`sender`、`description`、`is_enabled`、`protocols`；`as_token` / `hs_token` 不回显。

### 代理 `ANY /proxy/{as_id}/{*path}`

- `/_matrix/app/v1/proxy/{as_id}/{*path}` 与 `/_matrix/client/v1/proxy/{as_id}/{*path}` 是同一 handler 的别名，行为完全一致。
- 认证使用 `hs_token`，必须与注册值逐字节相等，否则 `401 M_UNAUTHORIZED`。
- AS 被禁用返回 `400 M_BAD_JSON`；`url: null` 返回 `503`；上游连接失败返回 `500`。
- 转发目标是 `{url}/_matrix/app/v1/{path}`，入站的 `.../proxy/{as_id}` 前缀不进入上游路径。
- 转发时剔除 hop-by-hop 头（`connection`、`keep-alive`、`te`、`trailer`、`transfer-encoding`、`upgrade`、`proxy-authenticate`、`proxy-authorization`、`host`、`content-length`），响应头同样剔除后回传，状态码与响应体原样透传。

### MSC4512 `fed_proxy`

- `POST /_matrix/client/v1/appservice/fed_proxy` 无条件注册；`POST /_matrix/client/unstable/io.element.msc4512/appservice/fed_proxy` 是 unstable 别名。
- 请求体为 `{destination, method, path, body?, query?}`；`destination` / `method` / `path` 必填且非空，`method` 只允许 `GET` / `POST` / `PUT` / `DELETE`，`path` 必须在 `/_matrix/federation/` 下，`body` 必须是 JSON 对象，`query` 的值必须全是字符串。
- 响应为 `{status, content}`。
- 调用方不是 AS、`destination` 指向本机、`path` 含 `.` / `..` 或越出 `proxy_prefix` 时返回 `403`；远端不可达返回 `502 M_FEDPROXY_CONNECTION_FAILED`。
- 入站前缀代理只允许声明 `rtc/livekit` 及其子路径（`ALLOWED_PROXY_PREFIXES`），其他前缀一律拒绝；该能力需要 `experimental.msc4512_enabled: true`。

### 管理面 17 条与状态码

- 管理面共 17 条：`GET|POST /appservices`、`GET|PUT|DELETE /appservices/{as_id}`、`POST /appservices/{as_id}/ping`、`POST|GET /appservices/{as_id}/state`、`GET /appservices/{as_id}/state/{state_key}`、`POST|GET /appservices/{as_id}/users`、`GET /appservices/{as_id}/namespaces`、`GET|POST /appservices/{as_id}/events`、`GET /appservices/query/user`、`GET /appservices/query/alias`、`GET /appservices/statistics`。
- `POST /appservices` 成功返回 `201`，`DELETE /appservices/{as_id}` 成功返回 `204` 且无响应体。
- `PUT /appservices/{as_id}` 只接受 `url`、`description`、`rate_limited`、`protocols`、`is_enabled` 五个字段；`as_token` / `hs_token` / `namespaces` 不能通过该端点修改。
- `as_id` 必须非空且不超过 255 字节；注册与更新请求体都启用 `deny_unknown_fields`，多传字段返回 `400 M_BAD_JSON`。
- 事件队列 `GET /appservices/{as_id}/events?limit=100` 的 `limit` 默认 100，clamp 到 `1..=500`；`POST /appservices/{as_id}/events` 返回 `201`。
