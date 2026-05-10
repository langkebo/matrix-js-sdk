---
module: account_data
generated_from: docs/api-contract/generated/modules/account_data.json
generated_hash: sha256-d5d47789fb1e6997fe727a6732c4a5b0fdf268789a680aa84ccf3fe54d324cf7
ledger_schema: 1
last_reviewed: 2026-05-03
---

# Account Data 模块契约

> **审查来源**: `synapse-rust/src/web/routes/account_data.rs`、`synapse-rust/src/web/routes/tags.rs`
> **数据库表**: `account_data`, `room_account_data`, `filters`, `openid_tokens`, `room_tags`
> **最后更新**: 2026-04-27

## 概述

本模块实际由两组路由共同构成：

- `account_data.rs`: 用户级/房间级 account data、filter、OpenID token。
- `tags.rs`: room tag 的全量读取、按房间读取、写入和删除。

两组路由都只挂载在 `/_matrix/client/r0` 与 `/_matrix/client/v3`，没有 `v1` 前缀。

## 挂载版本

| 前缀                 | 实际挂载                           |
| -------------------- | ---------------------------------- |
| `/_matrix/client/r0` | account data、filter、openid、tags |
| `/_matrix/client/v3` | account data、filter、openid、tags |

## 认证与权限

- 所有接口都要求 `AuthenticatedUser`。
- 路径中的 `user_id` 必须与当前 access token 对应的 `auth_user.user_id` 完全一致。
- 访问他人数据时统一返回 `403`。
- `tags.rs` 的拒绝消息为 `Access denied`；`account_data.rs` 根据操作不同返回 `Cannot get/set/delete ... for other users`。

## 路由总表

### Account Data / Filter / OpenID

| 方法     | 路径                                                                         | 说明                              | 实际响应                                                       |
| -------- | ---------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------- |
| `GET`    | `/_matrix/client/{r0,v3}/user/{user_id}/account_data/`                       | 列出用户级 account data           | `{ "account_data": { [data_type]: json } }`                    |
| `GET`    | `/_matrix/client/{r0,v3}/user/{user_id}/account_data/{type}`                 | 读取用户级 account data           | 直接返回该类型的 JSON 内容                                     |
| `PUT`    | `/_matrix/client/{r0,v3}/user/{user_id}/account_data/{type}`                 | 写入用户级 account data           | `{}`                                                           |
| `DELETE` | `/_matrix/client/{r0,v3}/user/{user_id}/account_data/{type}`                 | 删除用户级 account data           | `{}`                                                           |
| `GET`    | `/_matrix/client/{r0,v3}/user/{user_id}/rooms/{room_id}/account_data/{type}` | 读取房间级 account data           | 直接返回该类型的 JSON 内容                                     |
| `PUT`    | `/_matrix/client/{r0,v3}/user/{user_id}/rooms/{room_id}/account_data/{type}` | 写入房间级 account data           | `{}`                                                           |
| `DELETE` | `/_matrix/client/{r0,v3}/user/{user_id}/rooms/{room_id}/account_data/{type}` | 删除房间级 account data           | `{}`                                                           |
| `POST`   | `/_matrix/client/{r0,v3}/user/{user_id}/filter`                              | 创建 filter                       | `{ "filter_id": string }`                                      |
| `PUT`    | `/_matrix/client/{r0,v3}/user/{user_id}/filter`                              | 与 `POST` 相同，也会创建新 filter | `{ "filter_id": string }`                                      |
| `GET`    | `/_matrix/client/{r0,v3}/user/{user_id}/filter/{filter_id}`                  | 读取 filter                       | 直接返回 filter JSON                                           |
| `DELETE` | `/_matrix/client/{r0,v3}/user/{user_id}/filter/{filter_id}`                  | 删除 filter                       | `{}`                                                           |
| `GET`    | `/_matrix/client/{r0,v3}/user/{user_id}/openid/request_token`                | 生成 OpenID token                 | `{ access_token, token_type, matrix_server_name, expires_in }` |
| `POST`   | `/_matrix/client/{r0,v3}/user/{user_id}/openid/request_token`                | 与 `GET` 相同，也会生成新 token   | `{ access_token, token_type, matrix_server_name, expires_in }` |

### Tags

| 方法     | 路径                                                                | 说明                   | 实际响应                                                    |
| -------- | ------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------- |
| `GET`    | `/_matrix/client/{r0,v3}/user/{user_id}/tags`                       | 返回该用户全部房间标签 | `{ "tags": { [room_id]: { [tag]: { "order": number } } } }` |
| `GET`    | `/_matrix/client/{r0,v3}/user/{user_id}/rooms/{room_id}/tags`       | 返回单房间标签         | `{ "tags": { [tag]: { "order": number } } }`                |
| `PUT`    | `/_matrix/client/{r0,v3}/user/{user_id}/rooms/{room_id}/tags/{tag}` | 新增或覆盖标签         | `{}`                                                        |
| `DELETE` | `/_matrix/client/{r0,v3}/user/{user_id}/rooms/{room_id}/tags/{tag}` | 删除标签               | `{}`                                                        |

## 路由 ↔ SDK 方法映射

> 审查来源：`src/account-data/index.ts`（`AccountDataManager`）、`src/client-account-data-requests.ts`（路径构造）、`src/client.ts`（基础 `setAccountData / getAccountData` 与 tags 相关方法）。
> 标注：✅ = 已通过专用 Manager 封装；ℹ️ = 由 `MatrixClient` 基类直接封装；— = 无 SDK 入口（见兼容性说明）。

### Account Data（用户级）

| 方法 | 后端路由 | SDK 入口 | 说明 |
|------|---------|---------|------|
| `GET`    | `/user/{user_id}/account_data/`           | `AccountDataManager.listAccountData()` | ✅ 返回 `{ account_data: { [type]: content } }` |
| `GET`    | `/user/{user_id}/account_data/{type}`     | `AccountDataManager.getAccountDataFromServer(type)` / `getAccountData(type)` (本地缓存) | ✅ 缓存命中走 `store`；未命中时才发网络请求 |
| `PUT`    | `/user/{user_id}/account_data/{type}`     | `AccountDataManager.setAccountData(type, content)` | ✅ 写前校验 `data_type ≤ 128`、`content ≤ 64KB`，触发 `AccountDataUpdated` |
| `DELETE` | `/user/{user_id}/account_data/{type}`     | `AccountDataManager.deleteAccountData(type)` | ✅ 触发 `AccountDataUpdated`；错误触发 `AccountDataError` |

### Room Account Data（房间级）

| 方法 | 后端路由 | SDK 入口 | 说明 |
|------|---------|---------|------|
| `GET`    | `/user/{user_id}/rooms/{room_id}/account_data/{type}` | `AccountDataManager.getRoomAccountDataFromServer(roomId, type)` | ✅ 404 统一经 `normalizeError` |
| `PUT`    | `/user/{user_id}/rooms/{room_id}/account_data/{type}` | `AccountDataManager.setRoomAccountData(roomId, type, content)` | ✅ 与用户级一致，写前 `validateDataType` + `validateContentSize` |
| `DELETE` | `/user/{user_id}/rooms/{room_id}/account_data/{type}` | `AccountDataManager.deleteRoomAccountData(roomId, type)` | ✅ 后端删除不存在的记录也返回 `{}` |

### Filter

| 方法 | 后端路由 | SDK 入口 | 说明 |
|------|---------|---------|------|
| `POST` / `PUT` | `/user/{user_id}/filter`               | `MatrixClient.createFilter(filter)` | ℹ️ 基类封装；返回 `{ filter_id }` |
| `GET`          | `/user/{user_id}/filter/{filter_id}`   | `MatrixClient.getFilter(userId, filterId, allowCached?)` | ℹ️ 基类封装；`FilterComponent`/`Filter` 模型 |
| `DELETE`       | `/user/{user_id}/filter/{filter_id}`   | — | 后端支持，SDK 当前未暴露删除入口（保留兼容别名） |

### OpenID Token

| 方法 | 后端路由 | SDK 入口 | 说明 |
|------|---------|---------|------|
| `GET` / `POST` | `/user/{user_id}/openid/request_token` | `MatrixClient.getOpenIdToken()` | ℹ️ 基类封装；返回 `{ access_token, token_type, matrix_server_name, expires_in }` |

### Tags

| 方法 | 后端路由 | SDK 入口 | 说明 |
|------|---------|---------|------|
| `GET`    | `/user/{user_id}/tags`                         | — | 全量标签读取后端已就绪，SDK 以 sync `tag` EDU 聚合到 `Room.tags` 为准 |
| `GET`    | `/user/{user_id}/rooms/{room_id}/tags`         | `MatrixClient` 内部经由 sync / `Room.getTags()` 暴露 | ℹ️ 默认走 sync，也可经由 `http.authedRequest` 直接调用 |
| `PUT`    | `/user/{user_id}/rooms/{room_id}/tags/{tag}`   | `MatrixClient.setRoomTag(roomId, tag, metadata)` | ℹ️ `metadata.order` 可选 |
| `DELETE` | `/user/{user_id}/rooms/{room_id}/tags/{tag}`   | `MatrixClient.deleteRoomTag(roomId, tag)` | ℹ️ 删除未命中也返回 `{}` |

### SDK 事件（`AccountDataManager`）

| 事件 | 触发时机 |
|------|---------|
| `AccountDataEvent.AccountDataUpdated` | `setAccountData` / `getAccountDataFromServer` / `deleteAccountData` 成功时 |
| `AccountDataEvent.AccountDataError`   | 上述方法 `catch` 分支；`setRoomAccountData` / `getRoomAccountDataFromServer` / `deleteRoomAccountData` / `listAccountData` 目前只 throw，不额外 emit（与契约只 throw 保持一致） |

### 校验常量

| 常量 | 值 | 位置 | 对齐的后端校验 |
|------|----|----|-------------|
| `MAX_DATA_TYPE_LENGTH` | `128` | `src/account-data/index.ts:52` | 用户级 `PUT /account_data/{type}` |
| `MAX_CONTENT_SIZE`     | `65536` (64KB) | `src/account-data/index.ts:53` | 用户级 `PUT /account_data/{type}` body 上限；SDK 主动把同一约束对齐到房间级写入 |

## 关键行为对齐

### 1. 列出用户级 Account Data

**端点**: `GET /_matrix/client/{r0,v3}/user/{user_id}/account_data/`

**响应示例**:

```json
{
    "account_data": {
        "m.direct": {
            "@alice:example.com": ["!room1:example.com"]
        },
        "custom.type": {
            "key": "value"
        }
    }
}
```

**实际 SQL**:

```sql
SELECT data_type, content FROM account_data WHERE user_id = $1
```

### 2. 读取用户级 Account Data

**端点**: `GET /_matrix/client/{r0,v3}/user/{user_id}/account_data/{type}`

- 返回值不是包裹对象，而是数据库里该 `content` 的原始 JSON。
- 当 `type == "m.push_rules"` 且记录不存在时，不返回 `404`，而是返回默认骨架：

```json
{
    "global": {
        "content": [],
        "override": [],
        "room": [],
        "sender": [],
        "underride": []
    }
}
```

### 3. 写入用户级 Account Data

**端点**: `PUT /_matrix/client/{r0,v3}/user/{user_id}/account_data/{type}`

**后端硬性约束**:

- `data_type.len() <= 128`
- 请求体序列化后长度 `<= 65536` 字节
- 成功响应固定为 `{}`，状态码 `200`

**实际 SQL**:

```sql
INSERT INTO account_data (user_id, data_type, content, created_ts, updated_ts)
VALUES ($1, $2, $3, $4, $4)
ON CONFLICT (user_id, data_type) DO UPDATE SET content = $3, updated_ts = $4
```

### 4. 房间级 Account Data

**读取**:

```sql
SELECT data FROM room_account_data WHERE user_id = $1 AND room_id = $2 AND data_type = $3
```

**写入**:

```sql
INSERT INTO room_account_data (user_id, room_id, data_type, data, created_ts, updated_ts)
VALUES ($1, $2, $3, $4, $5, $5)
ON CONFLICT (user_id, room_id, data_type) DO UPDATE SET data = $4, updated_ts = $5
```

- 路由层没有像用户级 account data 那样额外检查 `data_type` 长度和 body 64KB 上限。
- 成功写入/删除都返回 `{}`，状态码 `200`。

### 5. Filter

**端点**: `POST|PUT /_matrix/client/{r0,v3}/user/{user_id}/filter`

- `POST` 与 `PUT` 都调用同一个 `create_filter()`。
- 每次调用都会生成新的 16 字符随机 `filter_id`。
- 返回不是 `201`，而是 `200` + `{ "filter_id": "..." }`。

**实际 SQL**:

```sql
INSERT INTO filters (filter_id, user_id, content, created_ts)
VALUES ($1, $2, $3, $4)
```

### 6. OpenID Token

**端点**: `GET|POST /_matrix/client/{r0,v3}/user/{user_id}/openid/request_token`

**响应示例**:

```json
{
    "access_token": "abc123def456...",
    "token_type": "Bearer",
    "matrix_server_name": "example.com",
    "expires_in": 3600
}
```

- `GET` 与 `POST` 都会创建新 token。
- `access_token` 为 32 字符随机串。
- `expires_in` 固定为 `3600` 秒。

### 7. Tags

**全量标签**: `GET /_matrix/client/{r0,v3}/user/{user_id}/tags`

```json
{
    "tags": {
        "!room1:example.com": {
            "m.favourite": { "order": 0.5 },
            "u.work": { "order": 1.0 }
        }
    }
}
```

**单房间标签**: `GET /_matrix/client/{r0,v3}/user/{user_id}/rooms/{room_id}/tags`

```json
{
    "tags": {
        "m.favourite": { "order": 0.5 }
    }
}
```

**写入标签请求体**:

```json
{
    "order": 0.5
}
```

- `order` 可缺省；后端读取时会把 `NULL` 归一成 `0.0` 返回。
- `PUT` 通过 `ON CONFLICT (user_id, room_id, tag)` 做 upsert。
- `DELETE` 当前实现无 “未命中即 404” 分支，删除不存在标签也返回 `{}`。

## 数据库表

### `account_data`

```sql
CREATE TABLE IF NOT EXISTS account_data (
    id BIGSERIAL,
    user_id TEXT NOT NULL,
    data_type TEXT NOT NULL,
    content JSONB NOT NULL,
    created_ts BIGINT NOT NULL,
    updated_ts BIGINT NOT NULL,
    CONSTRAINT pk_account_data PRIMARY KEY (id),
    CONSTRAINT uq_account_data_user_type UNIQUE (user_id, data_type)
);
```

### `room_account_data`

```sql
CREATE TABLE IF NOT EXISTS room_account_data (
    id BIGSERIAL,
    user_id TEXT NOT NULL,
    room_id TEXT NOT NULL,
    data_type TEXT NOT NULL,
    data JSONB NOT NULL,
    created_ts BIGINT NOT NULL,
    updated_ts BIGINT NOT NULL,
    CONSTRAINT pk_room_account_data PRIMARY KEY (id),
    CONSTRAINT uq_room_account_data_user_room_type UNIQUE (user_id, room_id, data_type)
);
```

### `filters`

```sql
CREATE TABLE IF NOT EXISTS filters (
    id BIGSERIAL,
    user_id TEXT NOT NULL,
    filter_id TEXT NOT NULL,
    content JSONB NOT NULL DEFAULT '{}',
    created_ts BIGINT NOT NULL,
    CONSTRAINT pk_filters PRIMARY KEY (id),
    CONSTRAINT uq_filters_user_filter UNIQUE (user_id, filter_id)
);
```

### `openid_tokens`

```sql
CREATE TABLE IF NOT EXISTS openid_tokens (
    id BIGSERIAL,
    token TEXT NOT NULL,
    user_id TEXT NOT NULL,
    device_id TEXT,
    created_ts BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    is_valid BOOLEAN DEFAULT TRUE,
    CONSTRAINT pk_openid_tokens PRIMARY KEY (id),
    CONSTRAINT uq_openid_tokens_token UNIQUE (token),
    CONSTRAINT fk_openid_tokens_user FOREIGN KEY (user_id)
        REFERENCES users(user_id) ON DELETE CASCADE
);
```

### `room_tags`

```sql
CREATE TABLE IF NOT EXISTS room_tags (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    room_id VARCHAR(255) NOT NULL,
    tag VARCHAR(255) NOT NULL,
    order_value DOUBLE PRECISION,
    created_ts BIGINT NOT NULL,
    CONSTRAINT uq_room_tags_user_room_tag UNIQUE (user_id, room_id, tag)
);
```

## 错误语义

| 场景                                             | HTTP  | 说明                                              |
| ------------------------------------------------ | ----- | ------------------------------------------------- |
| 访问他人资源                                     | `403` | `account_data.rs` 与 `tags.rs` 都先比较 `user_id` |
| account data / room account data / filter 不存在 | `404` | 读取或删除未命中时返回                            |
| `m.push_rules` 缺失                              | `200` | 返回默认骨架，不走 `404`                          |
| `data_type` 过长                                 | `400` | 仅用户级 `PUT /account_data/{type}` 明确校验      |
| 用户级 account data body 超 64KB                 | `400` | 错误文本为 `Account data too large (max 64KB)`    |
| 数据库写入/查询失败                              | `500` | 统一走 `ApiError::internal(...)`                  |

- 文档只对路由层显式可见的状态码和错误分支做承诺。
- `Axum` JSON 反序列化失败也会导致 `400`，但错误体细节由框架与统一错误封装共同决定，不在此文档中虚构固定文案。

## 兼容性说明

- 仅支持 `r0` 与 `v3`，不支持 `v1`。
- `POST /filter` 与 `PUT /filter` 等价。
- `GET /openid/request_token` 与 `POST /openid/request_token` 等价，都会新建 token。
- `tags` 路由与 account data 路由虽然分文件实现，但都已在 `assembly.rs` 中挂载，属于当前可达契约。

## 版本变更记录

### 2026-04-27

- 将 `tags.rs` 明确纳入 `account-data.md` 审查范围，补齐 `/tags` 全量与按房间标签接口。
- 修正文档中过时的错误码描述，移除未经后端代码证实的 `413 M_TOO_LARGE` 断言。
- 修正 filter / OpenID / tag 的真实响应形态与状态码。
- 补充 `room_tags` 表结构与 `order_value -> order` 的返回映射说明。

## 代码定位

- 路由与处理器: `synapse-rust/src/web/routes/account_data.rs`
- 标签路由: `synapse-rust/src/web/routes/tags.rs`
- 数据库迁移: `synapse-rust/migrations/00000000_unified_schema_v6.sql`
- 动态建表补充: `synapse-rust/src/services/database_initializer.rs`
