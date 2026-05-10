# 用户搜索与好友管理系统架构设计文档

> 版本: 1.0 | 日期: 2026-05-05 | 状态: 设计阶段
> 仓库: synapse-rust (后端) + matrix-js-sdk (前端)

---

## 目录

1. [系统总览与架构图](#1-系统总览与架构图)
2. [E2EE 安全分层模型](#2-e2ee-安全分层模型)
3. [用户搜索模块设计](#3-用户搜索模块设计)
4. [好友系统增强设计](#4-好友系统增强设计)
5. [房间功能集成设计](#5-房间功能集成设计)
6. [数据库索引与性能优化](#6-数据库索引与性能优化)
7. [错误处理与限流机制](#7-错误处理与限流机制)
8. [前端 SDK 接口规范](#8-前端-sdk-接口规范)
9. [测试策略](#9-测试策略)
10. [开发路线图](#10-开发路线图)

---

## 1. 系统总览与架构图

### 1.1 四层架构

```
┌──────────────────────────────────────────────────────────────────┐
│                     Frontend SDK (TypeScript)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │SearchManager │  │FriendManager │  │   CryptoModule (Olm)     │ │
│  │ searchUsers()│  │ ★ searchFri- │  │   encrypt/decrypt note   │ │
│  │ (NEW)        │  │   ends() NEW │  │   ★ optional             │ │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘ │
├─────────┼─────────────────┼───────────────────────┼───────────────┤
│         │    HTTPS + TLS 1.3 + Bearer Token       │               │
├─────────┼─────────────────┼───────────────────────┼───────────────┤
│                    Backend API (Axum)                               │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ GET /user/search       │ POST /friends/search   │ RateLimit  │ │
│  │ (NEW with cache)       │ (NEW from Plan A)      │ Middleware │ │
│  └───────────┬────────────┴──────────┬─────────────┴────────────┘ │
├──────────────┼───────────────────────┼────────────────────────────┤
│              │       Backend Service Layer                         │
│  ┌───────────────────┐  ┌───────────────────────────────────────┐ │
│  │ UserSearchService │  │ FriendRoomService (extended)          │ │
│  │ - searchUsers()   │  │ ★ searchFriends() NEW                 │ │
│  │ - rateLimit()     │  │ - sendNotification() NEW              │ │
│  │ - cacheControl()  │  │ - syncRoomPermissions() NEW           │ │
│  └─────────┬─────────┘  └──────────┬────────────────────────────┘ │
├────────────┼────────────────────────┼─────────────────────────────┤
│            │       Backend Storage Layer                           │
│  ┌──────────────────┐  ┌────────────────────────────────────────┐ │
│  │ UserStorage      │  │ FriendRoomStorage                      │ │
│  │ ★ searchUsers()  │  │ ★ searchFriends() NEW                  │ │
│  │   ✅ EXISTS      │  │ - getFriendsPaginated() NEW            │ │
│  │ - getProfile()   │  │ - getFriendCount()                     │ │
│  └──────────────────┘  └────────────────────────────────────────┘ │
├───────────────────────────────────────────────────────────────────┤
│                     PostgreSQL                                     │
│  ┌─────────┐  ┌──────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ users   │  │friend_relat- │  │friend_groups│  │rooms +      │ │
│  │         │  │ionships      │  │             │  │memberships  │ │
│  └─────────┘  └──────────────┘  └─────────────┘  └─────────────┘ │
└───────────────────────────────────────────────────────────────────┘
```

### 1.2 现有模块 vs 新增/增强

| 层级 | 现有 | 本次任务 |
|------|------|---------|
| **用户搜索** | `storage/user.rs:search_users()` ✅ 已实现 | 暴露路由 + 限流 + 缓存 + 前端封装 |
| **好友搜索** | ❌ 不存在 | 新增全链路（plan A） |
| **好友通知** | ❌ 不存在 | 新增 to-device message 通知 |
| **好友分页** | `get_friends()` 全量 | 新增分页+排序+在线状态 |
| **房间联动** | ❌ 无联动 | 新增权限联动 + 成员同步 |
| **note E2EE** | ❌ 明文 | 新增可选客户端加密 |
| **限流中间件** | `rate_limit.rs` ✅ Token Bucket | 接入搜索路由 |
| **缓存层** | Redis/user profile cache ✅ | 接入搜索结果缓存 |

---

## 2. E2EE 安全分层模型

### 2.1 核心原则

Matrix E2EE（Olm/Megolm）是 **room-scoped** 的。用户搜索和好友元数据无法直接使用 room 加密。因此采用以下三层安全模型：

```
┌──────────────────────────────────────────────────────────────────┐
│  Layer 3: Room Message E2EE (Olm/Megolm)                          │
│  ─────────────────────────────────────────────                    │
│  范围: 房间内的消息事件 (m.room.encrypted)                         │
│  密钥: Olm/Megolm session key per room                            │
│  状态: ✅ 已有 (DM 创建时自动启用 m.room.encryption)               │
├──────────────────────────────────────────────────────────────────┤
│  Layer 2: Metadata Transport Security (HTTPS + Auth)              │
│  ─────────────────────────────────────────────                    │
│  范围: 用户搜索 API / 好友 REST API / 通知传输                     │
│  保护: TLS 1.3 + Bearer Token + Rate Limit                        │
│  明文字段: user_id, display_name ✅ 公开标识符                     │
│  敏感字段: note (备注) → 客户端可选加密 (Layer 1)                  │
├──────────────────────────────────────────────────────────────────┤
│  Layer 1: Client-Side Optional Encryption                         │
│  ─────────────────────────────────────────────                    │
│  范围: note (好友备注) — 唯一具隐私风险的元数据字段                  │
│  实现: write → AES-GCM encrypt(note, localKey) → store ciphertext  │
│       read  → AES-GCM decrypt(ciphertext, localKey) → plaintext    │
│  search: ciphertext → 服务端 ILIKE 无效 → 退化为客户端搜索          │
│  注意: 启用后 friend search 只能用客户端方案                        │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 各数据字段安全等级

| 字段 | 等级 | 存储 | 传输 | 说明 |
|------|:---:|------|------|------|
| `user_id` | 🟢 公开 | 明文 | HTTPS | Matrix 固有公开标识符 |
| `display_name` | 🟢 公开 | 明文 | HTTPS | 用户自行设置的公开名 |
| `avatar_url` | 🟢 公开 | 明文 | HTTPS | 公开头像 URL |
| `email` | 🟡 私密 | 明文 | HTTPS | 仅搜索匹配用，不返回 |
| `note` | 🔴 敏感 | 明文/可选加密 | HTTPS | 用户自定义备注 |
| `friend_relationship` | 🟡 私密 | 明文 | HTTPS | 社交图谱，access-token 保护 |
| `room messages` | 🔴 私密 | Olm/Megolm | Olm/Megolm | ✅ 已有 E2EE |
| `to-device notifications` | 🔴 私密 | Plain JSON | HTTPS | SignalX/Curve25519 可选加密 |

---

## 3. 用户搜索模块设计

### 3.1 架构复用

**现有实现（`storage/user.rs:L386`）已覆盖核心搜索逻辑：**
```rust
// ✅ 已实现 — 直接复用
pub async fn search_users(query: &str, limit: i64) -> Result<Vec<UserSearchResult>, Error>
//   - ILIKE on (username, user_id, displayname)
//   - 排序: exact match > prefix match > fuzzy match > created_ts DESC
//   - 过滤: is_deactivated = FALSE
```

**本次新增：路由 + 限流 + 缓存 + 前端封装。**

### 3.2 API 规范

```
GET /_matrix/client/v3/user/search?q={query}&limit={N}&offset={M}&sort={field}

Query Parameters:
  q      : string (必填, 1-256) — 搜索关键词
  limit  : u32    (可选, 默认 20, 最大 100)
  offset : u32    (可选, 默认 0)
  sort   : "relevance" | "active" | "created" (可选, 默认 "relevance")

Response 200:
{
  "results": [
    {
      "user_id": "@alice:example.com",
      "display_name": "Alice",
      "avatar_url": "mxc://...",
      "is_friend": true,          // ★ 标注是否已是好友
      "mutual_friend_count": 3    // ★ 共同好友数
    }
  ],
  "total": 42,
  "query": "ali",
  "limit": 20,
  "offset": 0
}

Response 429 (Rate Limited):
{
  "errcode": "M_LIMIT_EXCEEDED",
  "error": "Too many requests",
  "retry_after_ms": 15000
}
```

### 3.3 路由实现（`src/web/routes/user.rs` 或新建 `user_search.rs`）

```rust
// 新增：GET /_matrix/client/v3/user/search

use crate::common::rate_limit::RateLimiter;
use crate::web::routes::extractors::auth::AuthenticatedUser;
use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct UserSearchQuery {
    pub q: String,
    #[serde(default = "default_limit")]
    pub limit: u32,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_sort")]
    pub sort: String,
}

fn default_limit() -> u32 { 20 }
fn default_sort() -> String { "relevance".to_string() }

async fn user_search(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
    Query(params): Query<UserSearchQuery>,
) -> Result<Json<Value>, ApiError> {
    // 1. 参数校验 (1-256 字符)
    if params.q.is_empty() || params.q.len() > 256 {
        return Err(ApiError::bad_request("q must be 1-256 characters"));
    }
    let limit = params.limit.min(100) as i64;
    let offset = params.offset as i64;

    // 2. 限流检查 (Token Bucket, 10 req/s per user)
    state.rate_limiter.check_user(&auth_user.user_id, "user_search")?;

    // 3. 缓存尝试 (TTL 30s)
    let cache_key = format!("search:user:{}:{}:{}:{}", 
        &params.q, limit, offset, &params.sort);
    if let Some(cached) = state.cache.get::<Value>(&cache_key).await {
        return Ok(Json(cached));
    }

    // 4. 执行搜索 (复用现有 storage::UserStorage)
    let results = state.storage.user.search_users(&params.q, limit + offset).await?;
    
    // 5. 增强结果 — 标注好友关系 + 共同好友数
    let friend_ids = state.storage.friend_room
        .get_user_friend_ids(&auth_user.user_id).await?;
    let enriched: Vec<Value> = results.into_iter()
        .skip(offset as usize)
        .take(limit as usize)
        .map(|u| {
            let is_friend = friend_ids.contains(&u.user_id);
            json!({
                "user_id": u.user_id,
                "display_name": u.displayname,
                "avatar_url": u.avatar_url,
                "is_friend": is_friend,
                // mutual_friend_count 可异步计算
            })
        })
        .collect();

    let response = json!({
        "results": enriched,
        "total": results.len(),
        "query": params.q,
        "limit": limit,
        "offset": offset
    });

    // 6. 写入缓存
    state.cache.set(&cache_key, &response, Duration::from_secs(30)).await;

    Ok(Json(response))
}
```

### 3.4 搜索缓存策略

| 缓存层 | TTL | 容量 | 用途 |
|--------|:---:|------|------|
| L1: Redis (搜索词→结果) | 30s | 全局 | 热门搜索命中 |
| L2: In-memory (user profile) | 5min | per-service | 用户资料不重复查 DB |
| L3: PostgreSQL ILIKE | — | 全量 | 冷查询直接查 DB |

### 3.5 搜索频率限制

```yaml
User Search Rate Limit:
  endpoint: GET /user/search
  per_user: 10 requests/second (token bucket, burst 20)
  per_ip:   30 requests/second
  per_anon: 1 request/second (未登录则更严格，防止爬虫)
  block_after: 连续 10 次 RateLimitExceeded → 封禁 5 分钟
```

现有 `rate_limit.rs` 的 Token Bucket 可直接接入，仅需添加 endpoint key。

---

## 4. 好友系统增强设计

### 4.1 新增功能 vs 现有功能

| 功能 | 现有状态 | 本次新增/增强 |
|------|:---:|------|
| 发送/接受/拒绝/取消请求 | ✅ | — |
| 删除好友 | ✅ | — |
| 好友分组 CRUD | ✅ | — |
| 好友备注 | ✅ | + 客户端可选加密 |
| 好友显示名 | ✅ | — |
| 好友状态 | ✅ | — |
| 好友建议(recommendations) | ✅ | — |
| **好友搜索** | ❌ | ✅ NEW (Plan A: `GET /friends/search`) |
| **好友列表分页+排序** | ❌ | ✅ NEW |
| **好友在线状态** | ❌ | ✅ NEW |
| **好友状态变更通知** | ❌ | ✅ NEW |
| **共同好友查询** | ❌ | ✅ NEW |

### 4.2 好友搜索（Plan A — 复用之前分析）

```
GET /_matrix/client/v1/friends/search?q={query}&limit={N}&offset={M}

后端实现路线:
  Step 1: FriendRoomStorage::search_friends()  — ILIKE on user_id / display_name / note
  Step 2: FriendRoomService::search_friends()   — 业务逻辑 + 聚合在线状态
  Step 3: friend_room.rs route                  — GET handler + 限流 + 缓存
  Step 4: contract:sync → contract:codegen
  Step 5: FriendManager::searchFriends()        — 前端 SDK
```

详见 [friend-search-optimization-plan.md](friend-search-optimization-plan.md) 第二部分 (2.2-2.3)。

### 4.3 好友列表分页 + 排序

```
GET /_matrix/client/v3/friends?limit={N}&offset={M}&sort={field}&online_only={bool}

Sort Options:
  "alphabetical" — A-Z by display_name
  "recent"       — 最近添加优先
  "active"       — 最近活跃优先 ★ 需要 presence 支持
  "status"       — favorite → normal → blocked → hidden

Response:
{
  "friends": [ Friend, ... ],
  "total": 42,
  "limit": 20,
  "offset": 0,
  "online_count": 7
}
```

前端 `getFriends()` 保持向后兼容（返回全量），新增 `getFriendsPaginated()`。

### 4.4 好友在线状态

利用现有 `presence` 模块：

```rust
// FriendRoomService::get_friends_with_presence()
//
// 1. 获取好友列表 (friend_room storage)
// 2. 批量查 presence (presence storage)
// 3. 合入 Friend 对象: { ..., presence: "online"|"offline"|"unavailable", last_active: timestamp }
```

前端 `Friend` 接口扩展：
```typescript
interface Friend {
    user_id: string;
    display_name?: string;
    avatar_url?: string;
    note?: string;
    status?: "favorite" | "normal" | "blocked" | "hidden";
    dm_room_id?: string;
    
    // ★ NEW fields
    presence?: "online" | "offline" | "unavailable";   // 在线状态
    last_active?: number;                                // 最后活跃时间 ms
    since?: number;                                      // 成为好友的时间
}
```

### 4.5 好友状态变更通知

使用 Matrix `to-device` message 机制：

```
POST /_matrix/client/v3/sendToDevice/m.room.friend_status/{txnId}

{
  "messages": {
    "@recipient:example.com": {
      "*": {
        "type": "m.room.friend_status",
        "content": {
          "action": "invited" | "accepted" | "rejected" | "removed" | "note_updated" | "status_updated",
          "sender_id": "@alice:example.com",
          "sender_display_name": "Alice",
          "timestamp": 1700000000000,
          "metadata": {
            "note": "Best friend (encrypted)",    // ★ 若启用客户端加密则为密文
            "status": "favorite"
          }
        }
      }
    }
  }
}
```

**关键设计**：to-device message 不走 room scope，它是用户到用户的直发消息。可以在此基础上加 SignalX 协议实现 to-device 层加密。

**前端事件**：`FriendManager` 监听到 to-device message → `emit(FriendEvent.NotificationReceived, ...)`

---

## 5. 房间功能集成设计

### 5.1 好友→房间数据流

```
A 发送好友请求 → B 接受 → 建立好友关系
                             │
                             ├──→ FriendManager.createDmRoom(B) 
                             │       (friend_room service 自动创建 DM)
                             │       └──→ create_room(encrypted=true) ✅
                             │
                             └──→ 共享房间场景:
                                    A 创建 shared room → invite B
                                    │
                                    B 加入 room → friend_room service
                                    同步 room_members → friend_relationship
                                    metadata: { shared_rooms: [...] }
```

### 5.2 房间权限联动模型

```sql
-- 新增表: friend_room_permissions
CREATE TABLE friend_room_permissions (
    friend_room_id  TEXT NOT NULL,     -- 好友列表房间 ID
    user_id         TEXT NOT NULL,
    friend_id       TEXT NOT NULL,
    shared_room_id  TEXT NOT NULL,
    permission      TEXT NOT NULL,     -- "invite" | "join" | "read" | "admin"
    granted_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    
    PRIMARY KEY (user_id, friend_id, shared_room_id)
);
```

权限策略：
```
is_friend(A, B) AND A.is_member(room) → B.has_permission(room, "join")
is_friend(A, B) AND A.is_admin(room)  → B.has_permission(room, "invite")
```

### 5.3 房间成员变更 ↔ 好友状态同步

```
Event: room.member.invite(B) by A
  → friend_room service.check_friendship(A, B)
  → if not friend: show "B is not your friend, send friend request first?"
  → if friend: auto-accept invite, send notification via to-device

Event: A.remove_friend(B)
  → check shared rooms
  → for each shared room:
      if is_dm(A, B): leave room (gracefully)
      if is_shared: show "B is no longer your friend, their permissions will be revoked"
```

### 5.4 DM 房间标识增强

```typescript
// Friend 对象扩展 dm_room_id 关联
interface Friend {
    dm_room_id?: string;   // ✅ 已有 — DM 房间 ID
    shared_room_ids?: string[];  // ★ NEW — 共有的非 DM 房间
}
```

---

## 6. 数据库索引与性能优化

### 6.1 必需索引

```sql
-- [users 表] — 搜索加速
CREATE INDEX IF NOT EXISTS idx_users_search 
    ON users USING GIN (username gin_trgm_ops, displayname gin_trgm_ops);   -- ★ pg_trgm 扩展
CREATE INDEX IF NOT EXISTS idx_users_user_id_pattern 
    ON users (user_id text_pattern_ops);

-- [friend_relationships 表] — 好友查询加速
CREATE INDEX IF NOT EXISTS idx_friend_rel_user_friend 
    ON friend_relationships (user_id, friend_id);
CREATE INDEX IF NOT EXISTS idx_friend_rel_status 
    ON friend_relationships (status) WHERE status = 'accepted';
CREATE INDEX IF NOT EXISTS idx_friend_rel_displayname 
    ON friend_relationships (display_name text_pattern_ops);   -- ★ 搜索加速

-- [friend_rooms 表] — 房间联动
CREATE INDEX IF NOT EXISTS idx_friend_rooms_user 
    ON friend_rooms (user_id);
```

### 6.2 pg_trgm 扩展（模糊搜索性能）

```sql
-- 启用 pg_trgm 扩展（生产环境一次）
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GiST/GIN 索引 — ILIKE 查询性能提升 100x
CREATE INDEX idx_friend_rel_friend_trgm 
    ON friend_relationships USING GIN (friend_id gin_trgm_ops);
CREATE INDEX idx_friend_rel_note_trgm  
    ON friend_relationships USING GIN (note gin_trgm_ops);
```

### 6.3 查询优化

```sql
-- ❌ 避免: 全表扫描 ILIKE
SELECT * FROM users WHERE displayname ILIKE '%pattern%';   -- Seq Scan

-- ✅ 优化: pg_trgm GIN 索引 + LIMIT
SELECT user_id, displayname FROM users 
WHERE displayname ILIKE '%pattern%' 
ORDER BY displayname 
LIMIT 20;   -- Bitmap Index Scan → Limit
```

### 6.4 连接池配置

```toml
# synapse-rust config
[database]
pool_size = 32             # PG 连接池
search_timeout_ms = 5000  # 搜索查询超时
search_cache_ttl_s = 30   # 搜索结果缓存 TTL
```

---

## 7. 错误处理与限流机制

### 7.1 错误码矩阵

| 场景 | HTTP Code | Errcode | Retry-After |
|------|:---:|------|:---:|
| 查询为空或过长 | 400 | `M_BAD_REQUEST` | — |
| 未认证 | 401 | `M_UNKNOWN_TOKEN` | — |
| 频率限制 | 429 | `M_LIMIT_EXCEEDED` | ✅ 15s |
| 搜索超时 | 500 | `M_SEARCH_TIMEOUT` | ❌ 不重试 |
| DB 不可用 | 503 | `M_UNAVAILABLE` | ✅ 30s |
| 用户已停用 | 404 | `M_NOT_FOUND` | — |
| 敏感词命中 | 403 | `M_FORBIDDEN` | — |

### 7.2 限流中间件接入

```rust
// 在路由中注册限流中间件
Router::new()
    .route("/user/search", get(user_search))
    .layer(RateLimitLayer::new(RateLimitConfig {
        requests_per_second: 10,    // 每用户每秒 10 次
        burst_size: 20,             // 允许瞬时突发 20 次
        per_user: true,
        per_ip: true,
        window_seconds: 60,
        ..Default::default()
    }))
```

### 7.3 友好错误提示

```typescript
// 前端 APIError → User-facing message mapping
const errorMessages = {
    "M_LIMIT_EXCEEDED":     "搜索过于频繁，请 {retry_after} 秒后再试",
    "M_SEARCH_TIMEOUT":     "搜索超时，请尝试更精确的关键词",
    "M_UNKNOWN_TOKEN":      "登录已过期，请重新登录",
    "M_BAD_REQUEST":        "请输入 1-256 个字符的关键词",
    "default":              "搜索服务暂不可用，请稍后重试"
};
```

---

## 8. 前端 SDK 接口规范

### 8.1 SearchManager（新建）

```typescript
// 文件: src/search/index.ts
// Manager: SearchManager extends BaseManager

class SearchManager extends BaseManager {
    /**
     * 全局用户搜索
     * @param query  - 搜索关键词 (1-256)
     * @param opts   - { limit?, offset?, sort? }
     */
    async searchUsers(
        query: string,
        opts?: { limit?: number; offset?: number; sort?: "relevance" | "active" }
    ): Promise<UserSearchResponse>;

    /**
     * 搜索好友（仅限已建立关系的好友）
     */
    async searchFriends(
        query: string,
        opts?: { limit?: number; offset?: number }
    ): Promise<FriendSearchResponse>;

    /**
     * 获取搜索建议（实时补全，debounce 300ms）
     */
    async suggest(query: string, limit?: number): Promise<Suggestion[]>;
}
```

### 8.2 FriendManager 新增方法

```typescript
// src/friend/index.ts — 扩展

// ★ NEW: 好友搜索
async searchFriends(query: string, limit?: number, offset?: number): Promise<...>;

// ★ NEW: 分页获取好友列表
async getFriendsPaginated(
    limit: number,
    offset: number,
    sort?: "alphabetical" | "recent" | "active"
): Promise<{ friends: Friend[]; total: number }>;

// ★ NEW: 获取在线好友数
async getOnlineFriendCount(): Promise<number>;

// ★ NEW: 获取共同好友
async getMutualFriends(userId: string): Promise<Friend[]>;

// ★ NEW: 可选加密备注 (Layer 1)
async setEncryptedNote(userId: string, note: string, encryptionKey: CryptoKey): Promise<void>;
async getDecryptedNote(userId: string, encryptionKey: CryptoKey): Promise<string | null>;
```

### 8.3 响应类型定义

```typescript
interface UserSearchResponse {
    results: UserSearchResult[];
    total: number;
    query: string;
    limit: number;
    offset: number;
}

interface UserSearchResult {
    user_id: string;
    display_name: string;
    avatar_url?: string;
    is_friend: boolean;           // ★ 是否已是好友
    mutual_friend_count?: number; // ★ 共同好友数
}

interface FriendSearchResponse {
    results: Friend[];
    total: number;
    query: string;
    limit: number;
    offset: number;
}

interface Friend {
    user_id: string;
    display_name?: string;
    avatar_url?: string;
    note?: string;                // ★ 启用 L1 加密则为 ciphertext
    status?: FriendStatus;
    dm_room_id?: string;
    presence?: PresenceState;     // ★ NEW
    last_active?: number;         // ★ NEW
    shared_room_ids?: string[];   // ★ NEW
}
```

---

## 9. 测试策略

### 9.1 单元测试覆盖

| 模块 | 测试重点 | 预计用例 |
|------|---------|:---:|
| `search_users()` | exact/prefix/fuzzy 匹配、空输入、超长输入、deactivated 过滤 | 8 |
| `search_friends()` | ILIKE on user_id/display_name/note、note 加密后搜索、分页 | 7 |
| `friend_relationship` | 完整请求流程、并发重复请求、幂等性 | 6 |
| `friend permissions` | is_friend→permission 映射、非好友的拒绝逻辑 | 4 |
| `rate_limiter` | Token Bucket 消耗/补充、burst 溢出、block 超限 | 5 |
| `notification` | to-device message 发送/接收、加密/解密 | 4 |
| **合计** | | **~34** |

### 9.2 端到端测试场景

```
Test Flow:
1. [Alice] 注册 → search_users("Bob") → 0 results (Bob 未注册)
2. [Bob]   注册 → search_users("bob") → 1 result (Bob 精确匹配)
3. [Alice] sendFriendRequest(Bob) → outgoing state
4. [Bob]   getIncomingRequests()  → Alice shows
5. [Bob]   acceptFriendRequest(Alice) → DM room created, E2EE enabled
6. [Alice] updateFriendNote(Bob, "Best") → searchFriends("Best") → Bob found
7. [Alice] sendMessage(dmRoom, "Hello Bob!") → ✅ E2EE encrypted message
8. [Bob]   receiveMessage → decrypt("Hello Bob!") ✅
9. [Alice] createSharedRoom() → invite Bob → Bob auto-joins (is_friend=true)
10.[Alice] removeFriend(Bob) → DM room leaves, shared room notification
```

### 9.3 性能测试基准

| 指标 | 目标 (P50) | P99 | 条件 |
|------|:---:|:---:|------|
| `GET /user/search` | < 200ms | < 500ms | 100万用户表 |
| `GET /friends/search` | < 100ms | < 300ms | 500好友 |
| `POST /friends/request` | < 50ms | < 200ms | — |
| `GET /friends` (paginated 20) | < 80ms | < 250ms | 500好友+presence |
| concurrent: 1000 req/s | < 400ms avg | < 1s | pg_trgm index + Redis cache |

### 9.4 安全测试

- [ ] SQL Injection attempt via `q` parameter (must fail)
- [ ] Access search without Bearer Token (must fail 401)
- [ ] Rate Limit → 11 consecutive requests in 1s (must get 429 on 11th)
- [ ] Encrypted note → ILIKE search should NOT match plaintext (L1 intent)
- [ ] Cross-user friendship check (Alice cannot see Bob's friend list)
- [ ] Deactivated user must not appear in search results

---

## 10. 开发路线图

### Phase 1: 用户搜索 (2-3 天)

| # | 任务 | 依赖 | 文件 |
|:---:|------|------|------|
| P1.1 | 暴露 `GET /user/search` 路由 | — | `src/web/routes/user.rs` |
| P1.2 | 接入限流中间件 | rate_limit.rs ✅ | 路由 `.layer()` |
| P1.3 | 搜索结果增强 (is_friend + mutual) | P1.1 | service layer |
| P1.4 | Redis 缓存层接入 | — | P1.1 cache logic |
| P1.5 | `SearchManager.searchUsers()` | P1.1 | `src/search/index.ts` |
| P1.6 | 单元测试 | P1.3 | `spec/unit/search.spec.ts` |
| P1.7 | contract:sync → contract:codegen | P1.1 | docs/api-contract/ |

### Phase 2: 好友搜索 + 分页 (2-3 天)

| # | 任务 | 依赖 | 文件 |
|:---:|------|------|------|
| P2.1 | FriendRoomStorage::search_friends() | — | `storage/friend_room.rs` |
| P2.2 | FriendRoomService::search_friends() | P2.1 | `services/friend_room_service.rs` |
| P2.3 | `GET /friends/search` 路由 | P2.2 | `friend_room.rs` |
| P2.4 | `GET /friends` 支持 pagination | — | `friend_room.rs` |
| P2.5 | `FriendManager.searchFriends()` | P2.3 | `friend/index.ts` |
| P2.6 | `FriendManager.getFriendsPaginated()` | P2.4 | `friend/index.ts` |
| P2.7 | 单元测试 + 合约更新 | P2.5 | spec/ doc/ |

### Phase 3: 在线状态 + 通知 (2 天)

| # | 任务 | 依赖 |
|:---:|------|------|
| P3.1 | Friend with presence (合入 presence 数据) | Phase 2 |
| P3.2 | to-device friend status notification | P3.1 |
| P3.3 | `FriendManager` 监听 to-device → emit Notification | P3.2 |
| P3.4 | `FriendEvent.NotificationReceived` 事件 | P3.3 |

### Phase 4: 房间集成 (2-3 天)

| # | 任务 | 依赖 |
|:---:|------|------|
| P4.1 | friend_room_permissions 表 (DB migration) | — |
| P4.2 | 好友关系 → 房间权限映射逻辑 | P4.1 + Phase 1 |
| P4.3 | 房间 member sync ↔ friend status | P4.2 |
| P4.4 | `Friend.shared_room_ids` 补充 | P4.3 |
| P4.5 | remove_friend → revoke room permissions | P4.4 |

### Phase 5: 安全加固 + 性能测试 (2 天)

| # | 任务 |
|:---:|------|
| P5.1 | note 客户端可选加密 (Layer 1) — SDK CryptoModule |
| P5.2 | pg_trgm 索引验证 + EXPLAIN ANALYZE |
| P5.3 | load-test (wrk/k6: 1000 concurrent search requests) |
| P5.4 | 安全审计 (SQL injection, auth bypass, rate limit bypass) |
| P5.5 | 文档终稿 + API 合约更新 |

### 总时长估算

```
Phase 1: ████████░░░░░░░░░░░  2-3d (用户搜索)
Phase 2: ████████████████░░  2-3d (好友搜索+分页)
Phase 3: ████████████░░░░░░  2d   (在线状态+通知)
Phase 4: ████████████████░░  2-3d (房间集成)
Phase 5: ████████████░░░░░░  2d   (安全+性能)
──────────────────────────────────
Total:   ██████████████████  10-13 个工作日 (~2.5 周)
```

---

## 附录 A: 关键决策记录

| ID | 决策 | 理由 |
|----|------|------|
| AD-01 | 用户搜索复用现有 `search_users()` storage | 数据库层已实现 ILIKE + 排序，避免重复开发 |
| AD-02 | 好友搜索用专用端点而非复用 `/search` | 遵循好友 API 前缀一致性 `/friends/*` |
| AD-03 | note 加密为可选客户端功能（非强制） | 强制加密则搜索退化为客户端全量遍历，性能开销大 |
| AD-04 | 通知用 to-device message 而非 room event | to-device 是1:1，不走 room scope，语义更精确 |
| AD-05 | pg_trgm GIN 索引（非 B-tree LIKE） | ILIKE with `%pattern%` 无法用 B-tree，trgm 是最佳实践 |

## 附录 B: 变更文件汇总

| 仓库 | 新增文件 | 修改文件 |
|------|---------|---------|
| synapse-rust | `routes/user_search.rs`、`services/user_search_service.rs` | `routes/friend_room.rs`、`services/friend_room_service.rs`、`storage/friend_room.rs`、`routes/mod.rs` |
| matrix-js-sdk | `src/search/index.ts`、`src/search/__generated__/` | `src/friend/index.ts`、`docs/api-contract/friend.md`、`spec/unit/search.spec.ts`、`spec/unit/friend.spec.ts` |

## 附录 C: 后续迭代

> 超出 Phase 1-5 范围，列入 backlog：

- 🔮 高级搜索（按标签/兴趣/共同好友筛选）
- 🔮 好友推荐算法（ML: 基于共同 room + mutual friends + interaction frequency）
- 🔮 SignalX to-device encryption（to-device message 的 E2EE 层）
- 🔮 Matrix MSC 提案：friend/v2 spec
- 🔮 联邦搜索（跨 homeserver 搜索用户）
