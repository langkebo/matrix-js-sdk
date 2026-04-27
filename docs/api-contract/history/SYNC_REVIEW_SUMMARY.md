# Sync 模块快速审查总结

> 说明: 本文件保留 2026-04-15 的阶段性审查快照。当前契约结论请以 `sync.md`、`README.md` 与 `CHANGELOG.md` 为准。


**审查日期**: 2026-04-15  
**审查状态**: ✅ 已完成基础审查

---

## 执行摘要

Sync 模块是 Matrix 协议的核心，负责客户端与服务器之间的数据同步。已完成后端代码审查，现有契约文档已经非常详细和完整。

### 审查结果

**核心文件**: 
- `synapse-rust/src/web/routes/sync.rs` (69 行)
- `synapse-rust/src/web/routes/handlers/sync.rs` (151 行)

**关键发现**:

1. **接口实现**（5 个核心接口）:
   - ✅ `GET /sync` - 主同步接口（支持 r0/v1/v3）
   - ✅ `GET /events` - 事件流接口
   - ✅ `GET /joined_rooms` - 获取已加入房间
   - ✅ `GET /my_rooms` - 获取我的房间（v3）
   - ✅ `POST /sync` - Sliding Sync（MSC3575）

2. **核心特性**:
   - 长轮询支持（timeout 参数）
   - 增量同步（since 参数）
   - 完整状态同步（full_state 参数）
   - 过滤器支持（filter 参数）
   - Lazy-load 成员优化
   - 速率限制（初始同步和增量同步分别限流）

3. **数据约束**:
   - timeout: 默认 30000ms，最大 60000ms
   - since: 格式为 `s{stream_id}` 或 `s{stream_id}_{to_device}_{device_lists}`
   - filter: 支持 filter_id 或 inline JSON

4. **速率限制**:
   - 初始同步（无 since）: 独立限流配置
   - 增量同步（有 since）: 独立限流配置
   - 使用 token bucket 算法
   - 按 user_id + device_id + kind 限流

---

## 核心接口

### 1. GET /sync

**端点**: `GET /_matrix/client/{r0,v1,v3}/sync`

**查询参数**:
- `since`: 增量同步令牌（可选）
- `timeout`: 长轮询超时（毫秒，默认 30000）
- `full_state`: 是否返回完整状态（默认 false）
- `set_presence`: 设置在线状态（默认 "online"）
- `filter`: 过滤器 ID 或 JSON

**响应 200**:
```json
{
  "next_batch": "s12345_1_2",
  "rooms": {
    "join": {
      "!room:example.com": {
        "state": { "events": [...] },
        "timeline": { "events": [...], "limited": false, "prev_batch": "t123" },
        "ephemeral": { "events": [...] },
        "account_data": { "events": [...] },
        "unread_notifications": {
          "highlight_count": 0,
          "notification_count": 5
        }
      }
    },
    "invite": {},
    "leave": {}
  },
  "presence": { "events": [...] },
  "account_data": { "events": [...] },
  "to_device": { "events": [...] },
  "device_lists": {
    "changed": ["@user:example.com"],
    "left": []
  },
  "device_one_time_keys_count": {}
}
```

**特点**:
- 初始同步（无 since）返回完整状态
- 增量同步（有 since）返回变更
- 支持长轮询（timeout）
- 支持 lazy-load 成员优化

### 2. GET /events

**端点**: `GET /_matrix/client/{r0,v3}/events`

**查询参数**:
- `from`: 起始令牌（默认 "0"）
- `timeout`: 超时时间（毫秒，默认 30000）

**响应 200**:
```json
{
  "start": "s12345",
  "end": "s12350",
  "chunk": [...]
}
```

### 3. GET /joined_rooms

**端点**: `GET /_matrix/client/{r0,v3}/joined_rooms`

**响应 200**:
```json
{
  "joined_rooms": [
    "!room1:example.com",
    "!room2:example.com"
  ]
}
```

### 4. GET /my_rooms

**端点**: `GET /_matrix/client/v3/my_rooms`

**响应 200**:
```json
{
  "rooms": [
    {
      "room_id": "!room1:example.com",
      "membership": "join",
      "name": "Room Name",
      "avatar_url": "mxc://..."
    }
  ],
  "total": 1
}
```

---

## 速率限制

### 配置

```rust
// 初始同步限流
ratelimit:sync:{user_id}:{device_id}:initial

// 增量同步限流
ratelimit:sync:{user_id}:{device_id}:incremental
```

### 参数

- `per_second`: 每秒允许的请求数
- `burst_size`: 突发容量
- `retry_after_seconds`: 重试延迟

### 实现

使用 token bucket 算法：
```rust
let decision = cache.rate_limit_token_bucket_take(
    &rate_limit_key,
    per_second,
    burst_size
).await?;

if !decision.allowed {
    return 429 M_LIMIT_EXCEEDED;
}
```

---

## Filter 支持

### 支持的过滤器

1. **顶层过滤**:
   - `event_fields`: 字段裁剪
   - `event_format`: 事件格式（client/federation）
   - `presence`: Presence 事件过滤

2. **房间过滤**:
   - `room.rooms`: 包含的房间
   - `room.not_rooms`: 排除的房间
   - `room.include_leave`: 包含离开的房间
   - `room.timeline.limit`: 时间线事件数量限制

3. **事件过滤**:
   - `types`: 包含的事件类型
   - `not_types`: 排除的事件类型
   - `senders`: 包含的发送者
   - `not_senders`: 排除的发送者
   - `contains_url`: 是否包含 URL

4. **Lazy-load 成员**:
   - `room.state.lazy_load_members`: 延迟加载成员
   - `room.timeline.lazy_load_members`: 延迟加载成员
   - `room.state.include_redundant_members`: 包含冗余成员

---

## 错误码

| 错误码 | HTTP 状态码 | 场景 |
|--------|------------|------|
| M_UNKNOWN_TOKEN | 401 | Token 无效 |
| M_LIMIT_EXCEEDED | 429 | 速率限制 |
| M_INTERNAL | 500 | 同步超时或内部错误 |

---

## 数据约束

| 字段 | 约束 | 说明 |
|------|------|------|
| timeout | 0-60000ms | 长轮询超时 |
| since | 字符串 | 格式: `s{stream_id}` |
| filter | 字符串或 JSON | filter_id 或 inline filter |

---

## 注意事项

1. **同步超时**: 
   - 处理器级别超时: 60 秒
   - 客户端超时: 由 timeout 参数控制

2. **速率限制**:
   - 初始同步和增量同步分别限流
   - 按 user_id + device_id 维度

3. **Lazy-load 优化**:
   - 减少成员事件传输
   - 按设备缓存成员状态
   - 支持跨请求复用

4. **Filter 缓存**:
   - 支持保存的 filter_id
   - 支持 inline JSON filter

5. **响应格式**:
   - 支持 client 格式（默认）
   - 支持 federation 格式（包含 depth/origin）

---

## 质量评价

**评级**: ⭐⭐⭐⭐⭐ **优秀**

**理由**:
- ✅ 现有文档已经非常详细和完整
- ✅ 覆盖了所有核心功能
- ✅ 包含详细的 filter 说明
- ✅ 包含 lazy-load 优化说明
- ✅ 速率限制机制清晰

---

## 建议

由于现有 sync.md 文档已经非常完整和详细，建议：

1. **保持现有文档**: 不需要大幅修改
2. **补充速率限制**: 添加速率限制的详细说明
3. **补充错误码**: 完善错误码映射
4. **补充示例**: 添加更多请求/响应示例

---

**审查人**: SDK 开发工程师  
**状态**: ✅ 完成  
**建议**: 现有文档质量高，仅需小幅补充