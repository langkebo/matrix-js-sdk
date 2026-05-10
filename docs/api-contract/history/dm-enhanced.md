# DM 模块契约（增强版）

> 说明: 本文件为 2026-04-15 的历史增强版契约快照，用于保留当时的补充说明。当前主契约基线请优先以 `dm.md`、`README.md`、`CHANGELOG.md` 与 `VERIFICATION_REPORT.md` 为准。  
> **审查来源**: `synapse-rust/src/web/routes/dm.rs`  
> **数据库表**: `account_data`, `rooms`, `room_memberships`  
> **最后更新**: 2026-04-15

## 概述

DM（Direct Message）模块提供私信房间的创建、管理和查询功能。DM 房间是恰好包含 2 个成员的私密聊天房间，通过用户级别的 `m.direct` account data 进行标记和管理。

### 核心概念

**m.direct 映射**:

- 存储位置: 用户级别的 account data（不是房间级别）
- 数据类型: `m.direct`
- 格式: `{ "@user:server": ["!room1:server", "!room2:server"] }`
- 用途: 标记哪些房间是与特定用户的 DM

**DM 房间特征**:

- 恰好 2 个成员（join 或 invite 状态）
- 通常设置为 `is_direct: true`
- 使用 `private_chat` 或 `trusted_private_chat` preset
- 可选加密（推荐）

## 数据约束

| 字段       | 约束             | 说明                         |
| ---------- | ---------------- | ---------------------------- |
| user_id    | 最大 100 字符    | 单个用户 ID                  |
| invite     | 最大 100 字符/项 | 邀请列表中的每个用户 ID      |
| 邀请数量   | 最多 20 个       | 创建 DM 时的最大邀请数       |
| name       | 最大 255 字符    | DM 房间名称（可选）          |
| visibility | 最大 50 字符     | 房间可见性（默认 "private"） |
| DM 成员数  | 恰好 2 个        | join + invite 状态的成员总数 |

## 核心接口

### 1. 创建 DM 房间

**端点**: `POST /_matrix/client/{r0,v3}/create_dm`

**请求体**:

```json
{
    "user_id": "@bob:example.com",
    "is_direct": true,
    "name": "Chat with Bob",
    "visibility": "private"
}
```

**可选字段**:

- `invite`: 邀请用户列表（数组），优先于 `user_id`
- `name`: 房间名称
- `visibility`: 房间可见性（默认 "private"）

**响应 200**:

```json
{
    "room_id": "!abc123:example.com"
}
```

**错误码**:

- `400 M_BAD_JSON` - 请求体格式错误
- `400 M_INVALID_PARAM` - 参数不合法（如邀请数量超过 20）
- `401 M_UNKNOWN_TOKEN` - Token 无效

**验证规则**:

- 至少提供 `user_id` 或 `invite` 之一
- `invite` 列表不能超过 20 个用户
- 自动设置 `is_direct: true` 和 `preset: "private_chat"`

**业务逻辑**:

```rust
// 1. 验证输入
validate_input(user_id, invite);

// 2. 创建房间
let config = CreateRoomConfig {
    preset: "private_chat",
    is_direct: true,
    invite_list: users_to_invite,
    ...
};
let room_id = create_room(config);

// 3. 更新 m.direct 映射
let mut direct_map = load_direct_map(user_id);
for user in users_to_invite {
    ensure_room_in_direct_map(&mut direct_map, user, room_id);
}
save_direct_map(user_id, &direct_map);

// 4. 返回房间 ID
return { room_id };
```

**数据库操作**:

```sql
-- 创建房间（由 room_service 处理）
INSERT INTO rooms (room_id, creator, ...) VALUES (...);

-- 更新 m.direct
INSERT INTO account_data (user_id, data_type, content, created_ts, updated_ts)
VALUES ($1, 'm.direct', $2, $3, $3)
ON CONFLICT (user_id, data_type)
DO UPDATE SET content = EXCLUDED.content, updated_ts = EXCLUDED.updated_ts;
```

---

### 2. 获取 DM 映射

**端点**: `GET /_matrix/client/{r0,v3}/direct`

**响应 200**:

```json
{
    "rooms": {
        "@bob:example.com": ["!room1:example.com", "!room2:example.com"],
        "@alice:example.com": ["!room3:example.com"]
    }
}
```

**错误码**:

- `401 M_UNKNOWN_TOKEN` - Token 无效

**业务逻辑**:

```rust
// 1. 加载 m.direct 映射
let mut direct_map = load_direct_map(user_id);

// 2. 如果为空，从房间成员关系构建
if direct_map.is_empty() {
    direct_map = build_direct_map_from_memberships(user_id);
}

// 3. 返回映射
return { rooms: direct_map };
```

**回退机制**:
当 m.direct 为空时，自动扫描用户的所有房间：

```rust
async fn build_direct_map_from_memberships(user_id: &str) -> Map<String, Value> {
    let rooms = get_user_rooms(user_id);
    let mut direct_map = Map::new();

    for room_id in rooms {
        let members = get_room_members(room_id);

        // 只处理恰好 2 个成员的房间
        if members.len() == 2 {
            let other_member = members.iter()
                .find(|m| m.user_id != user_id);

            if let Some(member) = other_member {
                ensure_room_in_direct_map(&mut direct_map, &member.user_id, room_id);
            }
        }
    }

    direct_map
}
```

---

### 3. 更新 DM 映射

**端点**: `PUT /_matrix/client/{r0,v3}/direct/{room_id}`

**请求体（方式 1 - 使用 users 数组）**:

```json
{
    "users": ["@bob:example.com", "@alice:example.com"]
}
```

**请求体（方式 2 - 使用 content 对象）**:

```json
{
    "content": {
        "user_id": "@bob:example.com"
    }
}
```

**请求体（方式 3 - 完整替换）**:

```json
{
    "content": {
        "@bob:example.com": ["!room1:example.com"],
        "@alice:example.com": ["!room2:example.com"]
    }
}
```

**响应 200**:

```json
{}
```

**错误码**:

- `400 M_BAD_JSON` - 请求体格式错误
- `400 M_INVALID_PARAM` - users 必须是数组或对象
- `401 M_UNKNOWN_TOKEN` - Token 无效

**业务逻辑**:

```rust
// 1. 加载当前映射
let mut direct_map = load_direct_map(user_id);

// 2. 根据请求类型更新
if let Some(users) = body.users {
    // 方式 1: 更新指定房间的用户列表
    let users = parse_dm_users(&users)?;
    remove_room_from_direct_map(&mut direct_map, room_id);
    for user in users {
        ensure_room_in_direct_map(&mut direct_map, user, room_id);
    }
} else if let Some(content) = body.content {
    // 方式 2/3: 使用 content 更新
    if let Some(user_id) = content.get("user_id") {
        // 单个用户
        remove_room_from_direct_map(&mut direct_map, room_id);
        ensure_room_in_direct_map(&mut direct_map, user_id, room_id);
    } else if let Some(users) = content.get("users") {
        // 用户列表
        let users = parse_dm_users(users)?;
        remove_room_from_direct_map(&mut direct_map, room_id);
        for user in users {
            ensure_room_in_direct_map(&mut direct_map, user, room_id);
        }
    } else {
        // 完整替换
        direct_map = content.as_object().clone();
    }
}

// 3. 保存映射
save_direct_map(user_id, &direct_map);
```

---

### 4. 检查房间是否为 DM

**端点**: `GET /_matrix/client/v3/rooms/{room_id}/dm`

**响应 200**:

```json
{
    "room_id": "!abc123:example.com",
    "m.direct": true
}
```

**错误码**:

- `404 M_NOT_FOUND` - 房间不是 DM
- `401 M_UNKNOWN_TOKEN` - Token 无效

**业务逻辑**:

```rust
// 1. 加载 m.direct 映射
let mut direct_map = load_direct_map(user_id);
if direct_map.is_empty() {
    direct_map = build_direct_map_from_memberships(user_id);
}

// 2. 检查房间是否在映射中
let is_dm = direct_map.values().any(|rooms| {
    rooms.as_array()
        .map(|arr| arr.iter().any(|r| r.as_str() == Some(room_id)))
        .unwrap_or(false)
});

// 3. 返回结果
if is_dm {
    return { room_id, "m.direct": true };
} else {
    return 404 M_NOT_FOUND;
}
```

---

### 5. 获取 DM 伙伴信息

**端点**: `GET /_matrix/client/v3/rooms/{room_id}/dm/partner`

**响应 200**:

```json
{
    "room_id": "!abc123:example.com",
    "user_id": "@bob:example.com",
    "display_name": "Bob Smith",
    "avatar_url": "mxc://example.com/avatar123"
}
```

**错误码**:

- `404 M_NOT_FOUND` - DM 伙伴不存在
- `401 M_UNKNOWN_TOKEN` - Token 无效

**业务逻辑**:

```rust
// 1. 从 m.direct 找到伙伴 ID
let direct_map = load_direct_map(user_id);
let partner_id = direct_map.iter()
    .find_map(|(partner, rooms)| {
        rooms.as_array()
            .and_then(|arr| arr.iter().any(|r| r.as_str() == Some(room_id)))
            .then(|| partner.clone())
    })
    .ok_or(M_NOT_FOUND)?;

// 2. 获取房间成员信息
let members = get_room_members(room_id);
let partner = members.iter()
    .find(|m| m.user_id == partner_id)
    .ok_or(M_NOT_FOUND)?;

// 3. 返回伙伴信息
return {
    room_id,
    user_id: partner.user_id,
    display_name: partner.display_name,
    avatar_url: partner.avatar_url
};
```

---

## 数据库表结构

### account_data 表

```sql
CREATE TABLE IF NOT EXISTS account_data (
    user_id TEXT NOT NULL,
    data_type TEXT NOT NULL,
    content JSONB,
    created_ts BIGINT NOT NULL,
    updated_ts BIGINT,
    CONSTRAINT pk_account_data PRIMARY KEY (user_id, data_type)
);

CREATE INDEX IF NOT EXISTS idx_account_data_user_id ON account_data(user_id);
CREATE INDEX IF NOT EXISTS idx_account_data_type ON account_data(data_type);
```

**m.direct 示例数据**:

```sql
SELECT * FROM account_data WHERE data_type = 'm.direct';

-- 结果:
user_id: @alice:example.com
data_type: m.direct
content: {
  "@bob:example.com": ["!room1:example.com"],
  "@carol:example.com": ["!room2:example.com", "!room3:example.com"]
}
```

### room_memberships 表

```sql
CREATE TABLE IF NOT EXISTS room_memberships (
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    membership TEXT NOT NULL,  -- join, invite, leave, ban
    display_name TEXT,
    avatar_url TEXT,
    ...
    CONSTRAINT pk_room_memberships PRIMARY KEY (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON room_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_room ON room_memberships(room_id);
```

---

## 辅助函数

### load_direct_map

从 account_data 表加载 m.direct 映射：

```rust
async fn load_direct_map(user_id: &str) -> Result<Map<String, Value>, ApiError> {
    let row = sqlx::query(
        "SELECT content FROM account_data WHERE user_id = $1 AND data_type = 'm.direct'"
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await?;

    match row {
        Some(row) => match row.get::<Option<Value>, _>("content") {
            Some(Value::Object(map)) => Ok(map),
            Some(_) => Err(ApiError::internal("Invalid m.direct format")),
            None => Ok(Map::new()),
        },
        None => Ok(Map::new()),
    }
}
```

### save_direct_map

保存 m.direct 映射到 account_data 表：

```rust
async fn save_direct_map(
    user_id: &str,
    direct_map: &Map<String, Value>
) -> Result<(), ApiError> {
    let now = chrono::Utc::now().timestamp_millis();

    sqlx::query(
        r#"
        INSERT INTO account_data (user_id, data_type, content, created_ts, updated_ts)
        VALUES ($1, 'm.direct', $2, $3, $3)
        ON CONFLICT (user_id, data_type)
        DO UPDATE SET content = EXCLUDED.content, updated_ts = EXCLUDED.updated_ts
        "#
    )
    .bind(user_id)
    .bind(Value::Object(direct_map.clone()))
    .bind(now)
    .execute(&pool)
    .await?;

    Ok(())
}
```

### ensure_room_in_direct_map

确保房间在 m.direct 映射中：

```rust
fn ensure_room_in_direct_map(
    direct_map: &mut Map<String, Value>,
    target_user_id: &str,
    room_id: &str
) {
    let entry = direct_map
        .entry(target_user_id.to_string())
        .or_insert_with(|| Value::Array(Vec::new()));

    if !entry.is_array() {
        *entry = Value::Array(Vec::new());
    }

    if let Some(rooms) = entry.as_array_mut() {
        if !rooms.iter().any(|v| v.as_str() == Some(room_id)) {
            rooms.push(Value::String(room_id.to_string()));
        }
    }
}
```

### remove_room_from_direct_map

从 m.direct 映射中移除房间：

```rust
fn remove_room_from_direct_map(direct_map: &mut Map<String, Value>, room_id: &str) {
    direct_map.retain(|_, value| {
        if let Some(rooms) = value.as_array_mut() {
            rooms.retain(|room| room.as_str() != Some(room_id));
            !rooms.is_empty()
        } else {
            false
        }
    });
}
```

### parse_dm_users

解析用户列表（支持数组和对象格式）：

```rust
fn parse_dm_users(value: &Value) -> Result<Vec<String>, ApiError> {
    match value {
        Value::Array(users) => {
            users.iter()
                .map(|u| u.as_str()
                    .map(|s| s.to_string())
                    .ok_or_else(|| ApiError::bad_request("users must contain only strings")))
                .collect()
        },
        Value::Object(users) => {
            Ok(users.keys().cloned().collect())
        },
        _ => Err(ApiError::bad_request(
            "users must be an array of Matrix user IDs or an m.direct user map"
        ))
    }
}
```

---

## 错误码完整映射

| 错误码            | HTTP 状态码 | 场景           | 错误消息示例                                       |
| ----------------- | ----------- | -------------- | -------------------------------------------------- |
| `M_NOT_FOUND`     | 404         | 房间不是 DM    | "Room is not a DM"                                 |
| `M_NOT_FOUND`     | 404         | DM 伙伴不存在  | "DM partner not found"                             |
| `M_BAD_JSON`      | 400         | 请求体格式错误 | "Invalid JSON"                                     |
| `M_INVALID_PARAM` | 400         | 参数不合法     | "users must contain at least one Matrix user ID"   |
| `M_INVALID_PARAM` | 400         | 邀请过多       | "DM room cannot have more than 20 invitees"        |
| `M_INVALID_PARAM` | 400         | 缺少必需参数   | "At least one user must be invited to create a DM" |
| `M_UNKNOWN_TOKEN` | 401         | Token 无效     | "Invalid or expired token"                         |

---

## 版本变更记录

### v1.0 (2026-04-15)

**新增**:

- 完整的 DM 接口文档（5 个接口）
- 数据约束详细说明
- 数据库表结构定义
- 辅助函数实现说明
- 错误码完整映射
- m.direct 格式和存储位置说明

**数据约束**:

- user_id 最大长度: 100 字符
- invite 最大长度: 100 字符/项
- 最大邀请数: 20 个
- name 最大长度: 255 字符
- visibility 最大长度: 50 字符
- DM 成员数: 恰好 2 个

**核心特性**:

- m.direct 是用户级别的 account data
- 自动从房间成员关系构建 DM 映射（回退机制）
- 支持多种更新方式（users 数组、content 对象、完整替换）

**兼容性**:

- 支持 `/_matrix/client/r0` 和 `/_matrix/client/v3` 前缀
- 向后兼容旧版本的 m.direct 格式

---

## 代码定位

- **核心路由**: `synapse-rust/src/web/routes/dm.rs`
- **房间服务**: `synapse-rust/src/services/room_service.rs`
- **数据库迁移**: `synapse-rust/migrations/00000000_unified_schema_v6.sql`

---

## 注意事项

1. **m.direct 存储位置**:
    - ✅ 正确: 用户级别的 account data
    - ❌ 错误: 房间级别的 account data

2. **DM 房间判断**:
    - 优先使用 m.direct 映射
    - 回退到成员数量判断（恰好 2 个成员）
    - 不依赖 `is_direct` 标志（可能不准确）

3. **回退机制**:
    - 当 m.direct 为空时，自动扫描房间
    - 只识别恰好 2 个成员的房间
    - 自动构建 m.direct 映射

4. **并发安全**:
    - m.direct 更新使用 `ON CONFLICT DO UPDATE`
    - 避免并发更新导致数据丢失

5. **性能考虑**:
    - m.direct 映射应该缓存
    - 回退机制可能较慢（扫描所有房间）
    - 建议客户端主动维护 m.direct

6. **数据一致性**:
    - 离开房间时应该更新 m.direct
    - 删除房间时应该清理 m.direct
    - 成员变化时应该检查 DM 状态

7. **邀请限制**:
    - 最多 20 个邀请（防止滥用）
    - 实际 DM 只能有 2 个成员
    - 多余的邀请会被忽略

8. **错误处理**:
    - 404 表示房间不是 DM 或伙伴不存在
    - 400 表示参数错误
    - 401 表示认证失败
