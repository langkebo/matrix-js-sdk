# Device 模块契约（增强版）

> 说明: 本文件为 2026-04-15 的历史增强版契约快照，用于保留当时的补充说明。当前主契约基线请优先以 `device.md`、`README.md`、`CHANGELOG.md` 与 `VERIFICATION_REPORT.md` 为准。  
> **审查来源**: `synapse-rust/src/web/routes/device.rs`  
> **数据库表**: `devices`, `device_lists_changes`, `device_lists_stream`  
> **最后更新**: 2026-04-15

## 概述

Device 模块提供设备管理功能，包括设备的创建、查询、更新和删除，以及设备列表变更的追踪。每个用户可以有多个设备（如手机、电脑、平板等），每个设备都有唯一的 device_id。

### 核心概念

**设备（Device）**:
- 每个登录会话对应一个设备
- device_id 在登录时生成（16 字符）
- 用于端到端加密的密钥管理
- 可以设置显示名称（如 "iPhone 13"）

**设备列表变更追踪**:
- 使用 stream_id 追踪设备变更
- 支持增量同步（since/to 参数）
- 用于 E2EE 密钥分发

## 数据约束

| 字段 | 约束 | 说明 |
|------|------|------|
| device_id | 16 字符 | 服务器生成的唯一标识 |
| display_name | 可选，无长度限制 | 设备显示名称 |
| last_seen_ts | 时间戳（毫秒） | 最后活跃时间 |
| last_seen_ip | IP 地址字符串 | 最后活跃 IP |
| user_id | Matrix User ID | 设备所属用户 |
| stream_id | 整数 | 设备变更流位置 |

## 核心接口

### 1. 获取所有设备

**端点**: `GET /_matrix/client/{r0,v3}/devices`

**响应 200**:
```json
{
  "devices": [
    {
      "device_id": "ABCDEFGHIJKLMNOP",
      "display_name": "iPhone 13",
      "last_seen_ts": 1234567890000
    },
    {
      "device_id": "QRSTUVWXYZ123456",
      "display_name": "MacBook Pro",
      "last_seen_ts": 1234567891000
    }
  ]
}
```

**错误码**:
- `401 M_UNKNOWN_TOKEN` - Token 无效

**业务逻辑**:
```rust
// 1. 验证用户认证
let auth_user = extract_authenticated_user(request);

// 2. 查询用户的所有设备
let devices = device_storage.get_user_devices(&auth_user.user_id).await?;

// 3. 返回设备列表
return {
    devices: devices.map(|d| {
        device_id: d.device_id,
        display_name: d.display_name,
        last_seen_ts: d.last_seen_ts
    })
};
```

**数据库操作**:
```sql
SELECT device_id, display_name, last_seen_ts, last_seen_ip
FROM devices
WHERE user_id = $1
ORDER BY created_ts DESC;
```

---

### 2. 获取单个设备

**端点**: `GET /_matrix/client/{r0,v3}/devices/{device_id}`

**响应 200**:
```json
{
  "device": {
    "device_id": "ABCDEFGHIJKLMNOP",
    "display_name": "iPhone 13",
    "last_seen_ts": 1234567890000
  },
  "device_id": "ABCDEFGHIJKLMNOP",
  "display_name": "iPhone 13",
  "last_seen_ts": 1234567890000
}
```

**注意**: 响应同时包含嵌套的 `device` 对象和扁平字段，用于兼容不同客户端。

**错误码**:
- `401 M_UNKNOWN_TOKEN` - Token 无效
- `404 M_NOT_FOUND` - 设备不存在或不属于当前用户

**业务逻辑**:
```rust
// 1. 验证用户认证
let auth_user = extract_authenticated_user(request);

// 2. 查询设备
let device = device_storage.get_device(&device_id).await?;

// 3. 验证设备所有权
if device.user_id != auth_user.user_id {
    return 404 M_NOT_FOUND;
}

// 4. 返回设备信息（双格式）
return {
    device: { device_id, display_name, last_seen_ts },
    device_id,
    display_name,
    last_seen_ts
};
```

**数据库操作**:
```sql
SELECT device_id, user_id, display_name, last_seen_ts, last_seen_ip
FROM devices
WHERE device_id = $1;
```

---

### 3. 更新设备显示名

**端点**: `PUT /_matrix/client/{r0,v3}/devices/{device_id}`

**请求体**:
```json
{
  "display_name": "My New iPhone"
}
```

**响应 200**:
```json
{
  "device_id": "ABCDEFGHIJKLMNOP",
  "display_name": "My New iPhone",
  "updated_ts": 1234567890000
}
```

**错误码**:
- `400 M_BAD_JSON` - 缺少 display_name
- `401 M_UNKNOWN_TOKEN` - Token 无效
- `404 M_NOT_FOUND` - 设备不存在

**业务逻辑**:
```rust
// 1. 验证用户认证
let auth_user = extract_authenticated_user(request);

// 2. 验证请求体
let display_name = body.get("display_name")
    .ok_or(M_BAD_JSON)?;

// 3. 更新设备
let rows_affected = device_storage
    .update_user_device_display_name(&auth_user.user_id, &device_id, display_name)
    .await?;

// 4. 检查是否更新成功
if rows_affected == 0 {
    return 404 M_NOT_FOUND;
}

// 5. 返回更新后的设备信息
return {
    device_id,
    display_name,
    updated_ts: now()
};
```

**数据库操作**:
```sql
UPDATE devices
SET display_name = $1, updated_ts = $2
WHERE user_id = $3 AND device_id = $4
RETURNING device_id, display_name;
```

---

### 4. 删除单个设备

**端点**: `DELETE /_matrix/client/{r0,v3}/devices/{device_id}`

**响应 200**:
```json
{}
```

**错误码**:
- `401 M_UNKNOWN_TOKEN` - Token 无效
- `404 M_NOT_FOUND` - 设备不存在

**业务逻辑**:
```rust
// 1. 验证用户认证
let auth_user = extract_authenticated_user(request);

// 2. 删除设备
let rows_affected = device_storage
    .delete_user_device(&auth_user.user_id, &device_id)
    .await?;

// 3. 检查是否删除成功
if rows_affected == 0 {
    return 404 M_NOT_FOUND;
}

// 4. 返回空对象
return {};
```

**数据库操作**:
```sql
-- 删除设备
DELETE FROM devices
WHERE user_id = $1 AND device_id = $2;

-- 记录设备变更
INSERT INTO device_lists_changes (user_id, device_id, change_type, stream_id)
VALUES ($1, $2, 'deleted', nextval('device_lists_stream_seq'));
```

**注意事项**:
- 删除设备会触发设备列表变更事件
- 相关的加密密钥也应该被清理
- 不能删除当前正在使用的设备（SDK 层面保护）

---

### 5. 批量删除设备

**端点**: `POST /_matrix/client/{r0,v3}/delete_devices`

**请求体**:
```json
{
  "device_ids": ["DEVICE1", "DEVICE2", "DEVICE3"]
}
```

或者使用 `devices` 字段（兼容）:
```json
{
  "devices": ["DEVICE1", "DEVICE2", "DEVICE3"]
}
```

**响应 200**:
```json
{}
```

**错误码**:
- `400 M_BAD_JSON` - 缺少 device_ids/devices 或格式错误
- `400 M_INVALID_PARAM` - device_ids 不是字符串数组
- `401 M_UNKNOWN_TOKEN` - Token 无效

**业务逻辑**:
```rust
// 1. 验证用户认证
let auth_user = extract_authenticated_user(request);

// 2. 解析设备 ID 列表
let device_ids = parse_device_ids(&body)?;

// 3. 批量删除设备
device_storage
    .delete_user_devices_batch(&auth_user.user_id, &device_ids)
    .await?;

// 4. 返回空对象
return {};
```

**辅助函数**:
```rust
fn parse_device_ids(body: &Value) -> Result<Vec<String>, ApiError> {
    // 支持 device_ids 或 devices 字段
    let raw_device_ids = body
        .get("device_ids")
        .or_else(|| body.get("devices"))
        .and_then(|v| v.as_array())
        .ok_or_else(|| ApiError::bad_request("Missing device_ids"))?;
    
    // 验证所有元素都是字符串
    if raw_device_ids.iter().any(|v| !v.is_string()) {
        return Err(ApiError::bad_request("device_ids must be an array of strings"));
    }
    
    Ok(raw_device_ids
        .iter()
        .filter_map(|v| v.as_str().map(String::from))
        .collect())
}
```

**数据库操作**:
```sql
-- 批量删除设备
DELETE FROM devices
WHERE user_id = $1 AND device_id = ANY($2);

-- 批量记录设备变更
INSERT INTO device_lists_changes (user_id, device_id, change_type, stream_id)
SELECT $1, unnest($2::text[]), 'deleted', nextval('device_lists_stream_seq');
```

---

### 6. 查询设备列表变更

**端点**: `POST /_matrix/client/{r0,v3}/keys/device_list_updates`

**请求体（初始同步）**:
```json
{
  "users": ["@alice:example.com", "@bob:example.com"]
}
```

**响应 200（初始同步）**:
```json
{
  "changed": [
    {
      "user_id": "@alice:example.com",
      "device_id": "DEVICE1",
      "device_data": {
        "display_name": "Alice's Phone",
        "last_seen_ts": 1234567890000
      }
    }
  ],
  "left": ["@bob:example.com"]
}
```

**请求体（增量同步）**:
```json
{
  "users": ["@alice:example.com", "@bob:example.com"],
  "since": 12345,
  "to": 12350
}
```

或者使用字符串格式的 stream_id:
```json
{
  "users": ["@alice:example.com"],
  "from": "s12345",
  "to": "s12350"
}
```

**响应 200（增量同步）**:
```json
{
  "changed": [
    {
      "user_id": "@alice:example.com",
      "device_id": "DEVICE1",
      "device_data": {
        "display_name": "Alice's New Phone",
        "last_seen_ts": 1234567891000
      }
    }
  ],
  "deleted": [
    {
      "user_id": "@alice:example.com",
      "device_id": "DEVICE2"
    }
  ],
  "left": [],
  "stream_id": 12350
}
```

**错误码**:
- `400 M_BAD_JSON` - 缺少 users 数组
- `401 M_UNKNOWN_TOKEN` - Token 无效

**业务逻辑**:
```rust
// 1. 验证用户认证
let auth_user = extract_authenticated_user(request);

// 2. 解析请求参数
let requested_users = body.get("users")
    .and_then(|v| v.as_array())
    .ok_or(M_BAD_JSON)?;

// 3. 过滤：只返回有共享房间的用户
let users = filter_users_with_shared_rooms(&auth_user.user_id, &requested_users).await;

// 4. 解析 since/from 参数
let since = body.get("since")
    .or_else(|| body.get("from"))
    .and_then(parse_stream_id);

// 5. 如果没有 since，返回所有设备（初始同步）
if since.is_none() {
    return initial_sync(users);
}

// 6. 增量同步
let since = since.unwrap();
let to = body.get("to")
    .and_then(parse_stream_id)
    .unwrap_or_else(|| get_max_stream_id());

// 7. 查询设备变更
let changes = query_device_changes(since, to, &users).await?;

// 8. 返回变更结果
return {
    changed: [...],
    deleted: [...],
    left: [...],
    stream_id: to
};
```

**辅助函数**:
```rust
fn parse_stream_id(value: &Value) -> Option<i64> {
    // 支持数字格式
    if let Some(n) = value.as_i64() {
        return Some(n);
    }
    
    // 支持字符串格式（如 "s12345"）
    let s = value.as_str()?;
    let s = s.strip_prefix('s').unwrap_or(s);
    s.parse::<i64>().ok()
}
```

**数据库操作**:
```sql
-- 查询最大 stream_id
SELECT COALESCE(MAX(stream_id), 0) FROM device_lists_stream;

-- 查询设备变更
SELECT user_id, device_id, change_type, stream_id
FROM device_lists_changes
WHERE stream_id > $1
  AND stream_id <= $2
  AND user_id = ANY($3)
ORDER BY stream_id ASC;

-- 查询设备详情
SELECT display_name, last_seen_ts
FROM devices
WHERE user_id = $1 AND device_id = $2;

-- 查询存在设备的用户
SELECT DISTINCT user_id FROM devices WHERE user_id = ANY($1);
```

**注意事项**:
- 只返回有共享房间的用户的设备信息（隐私保护）
- stream_id 支持数字和字符串格式（如 "s12345"）
- 初始同步（无 since）返回所有设备
- 增量同步返回变更、删除和离开的设备

---

## 数据库表结构

### devices 表

```sql
CREATE TABLE IF NOT EXISTS devices (
    device_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    display_name TEXT,
    device_key JSONB,
    last_seen_ts BIGINT,
    last_seen_ip TEXT,
    created_ts BIGINT NOT NULL,
    first_seen_ts BIGINT NOT NULL,
    user_agent TEXT,
    appservice_id TEXT,
    ignored_user_list TEXT,
    CONSTRAINT pk_devices PRIMARY KEY (device_id),
    CONSTRAINT fk_devices_user FOREIGN KEY (user_id) 
        REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen_ts DESC);
```

**关键字段**:
- `device_id`: 设备唯一标识（16 字符）
- `user_id`: 设备所属用户
- `display_name`: 设备显示名称
- `device_key`: 设备加密密钥（JSONB）
- `last_seen_ts`: 最后活跃时间
- `last_seen_ip`: 最后活跃 IP

### device_lists_changes 表

```sql
CREATE TABLE IF NOT EXISTS device_lists_changes (
    stream_id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_id TEXT,
    change_type TEXT NOT NULL,  -- 'created', 'updated', 'deleted'
    created_ts BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
);

CREATE INDEX IF NOT EXISTS idx_device_lists_changes_user ON device_lists_changes(user_id);
CREATE INDEX IF NOT EXISTS idx_device_lists_changes_stream ON device_lists_changes(stream_id);
```

**关键字段**:
- `stream_id`: 变更流位置（自增）
- `user_id`: 变更的用户
- `device_id`: 变更的设备
- `change_type`: 变更类型（created/updated/deleted）

### device_lists_stream 表

```sql
CREATE TABLE IF NOT EXISTS device_lists_stream (
    stream_id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_ts BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_device_lists_stream_user ON device_lists_stream(user_id);
```

---

## 错误码完整映射

| 错误码 | HTTP 状态码 | 场景 | 错误消息示例 |
|--------|------------|------|-------------|
| `M_BAD_JSON` | 400 | 缺少必需字段 | "Missing display_name" |
| `M_BAD_JSON` | 400 | 缺少 device_ids | "Missing device_ids" |
| `M_BAD_JSON` | 400 | 缺少 users 数组 | "Missing users array" |
| `M_INVALID_PARAM` | 400 | device_ids 格式错误 | "device_ids must be an array of strings" |
| `M_UNKNOWN_TOKEN` | 401 | Token 无效 | "Invalid or expired token" |
| `M_NOT_FOUND` | 404 | 设备不存在 | "Device not found" |
| `M_NOT_FOUND` | 404 | 设备不属于当前用户 | "Device not found" |

---

## 版本变更记录

### v1.0 (2026-04-15)

**新增**:
- 完整的设备管理接口文档（6 个接口）
- 数据约束详细说明
- 数据库表结构定义（3 个表）
- 错误码完整映射
- 设备列表变更追踪机制说明

**数据约束**:
- device_id 长度: 16 字符
- display_name: 无长度限制
- stream_id: 整数，自增

**核心特性**:
- 设备 CRUD 操作
- 批量删除设备
- 设备列表变更追踪（初始同步 + 增量同步）
- 隐私保护（只返回有共享房间的用户设备）

**兼容性**:
- 支持 `/_matrix/client/r0` 和 `/_matrix/client/v3` 前缀
- device_ids 和 devices 字段兼容
- since 和 from 字段兼容
- stream_id 支持数字和字符串格式

---

## 代码定位

- **核心路由**: `synapse-rust/src/web/routes/device.rs`
- **设备存储**: `synapse-rust/src/storage/device_storage.rs`
- **数据库迁移**: `synapse-rust/migrations/00000000_unified_schema_v6.sql`

---

## 注意事项

1. **设备 ID 生成**:
   - 登录时由服务器生成（16 字符）
   - 客户端不能自定义 device_id

2. **设备所有权验证**:
   - 所有操作都验证设备属于当前用户
   - 不能操作其他用户的设备

3. **当前设备保护**:
   - SDK 应该阻止删除当前正在使用的设备
   - 避免用户意外登出

4. **设备列表变更**:
   - 用于 E2EE 密钥分发
   - 只返回有共享房间的用户（隐私保护）
   - 支持初始同步和增量同步

5. **stream_id 格式**:
   - 支持数字: `12345`
   - 支持字符串: `"s12345"`
   - 自动解析和转换

6. **批量删除**:
   - 支持 `device_ids` 和 `devices` 字段
   - 所有设备必须属于当前用户

7. **响应格式兼容**:
   - `GET /devices/{device_id}` 同时返回嵌套和扁平格式
   - 兼容不同版本的客户端

8. **数据库级联删除**:
   - 删除用户时自动删除所有设备
   - 使用 `ON DELETE CASCADE`
