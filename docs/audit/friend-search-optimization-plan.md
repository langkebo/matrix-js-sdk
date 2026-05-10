# 好友搜索功能 & Commit Hash 优化方案

> 日期：2026-05-05  
> 审计依据：`synapse-rust/src/web/routes/friend_room.rs` + `friend_room_service.rs` + `friend_room.rs`(storage)

---

## 第一部分：好友搜索功能深度排查结论

### 1.1 排查范围

| 层级 | 文件 | 搜索能力 |
|------|------|:---:|
| 路由层 | `synapse-rust/src/web/routes/friend_room.rs` | ❌ 无 `/friends/search` 路由 |
| 路由层 | `synapse-rust/src/web/routes/handlers/search.rs` | ❌ 仅支持 `room_events` 搜索，不支持好友/用户搜索 |
| 服务层 | `synapse-rust/src/services/friend_room_service.rs` | ❌ 28 个方法中无搜索方法 |
| 存储层 | `synapse-rust/src/storage/friend_room.rs` | ❌ 有 `get_user_friend_ids()` 但不支持 LIKE 条件搜索 |

### 1.2 结论

**后端完全未实现好友搜索功能。** 当前仅有的搜索能力是 Matrix 规范中的 `/search` 端点，仅支持房间事件全文搜索，无法用于搜索好友。好友建议（`get_friend_suggestions`）是基于共同好友/共享房间的推荐系统，不是文本搜索。

---

## 第二部分：好友搜索功能优化完善方案

### 2.1 方案对比

| 维度 | 方案 A：专用端点 | 方案 B：复用 /search | 方案 C：前端本地搜索 |
|------|:---:|:---:|:---:|
| 后端改动 | 🟡 新增路由+服务+存储 | 🔴 扩展 search.rs | 🟢 无需 |
| 前端改动 | 🟡 新增方法 | 🟡 新增方法 | 🟡 新增本地方法 |
| 搜索体验 | ⭐⭐⭐⭐⭐ 精确搜索 | ⭐⭐⭐⭐ 自定义分类 | ⭐⭐ 全量拉取后过滤 |
| 大数据量性能 | ⭐⭐⭐⭐⭐ 数据库索引 | ⭐⭐⭐⭐ 通用索引 | ⭐ 全量内存过滤 |
| 一致性 | ⭐⭐⭐⭐⭐ 遵循现有模式 | ⭐⭐⭐ 非标准模式 | ⭐⭐ 仅 SDK 层面 |
| 可扩展性 | ⭐⭐⭐⭐⭐ 独立演进 | ⭐⭐⭐ 耦合到 search | ⭐ 不可扩展 |

### 2.2 推荐方案：方案 A — 专用 `GET /friends/search` 端点

#### 理由
1. 遵循现有好友 API 设计模式（所有端点以 `/friends/` 为前缀）
2. 独立演进，不与通用搜索耦合
3. 可利用数据库索引实现高效 LIKE/ILIKE 查询
4. 前端 SDK 方法命名自然（`searchFriends(query, options?)`）

#### 2.3 实现步骤

##### Step 1：后端存储层（`src/storage/friend_room.rs`）

新增 `search_friends` 方法：

```rust
pub async fn search_friends(
    &self,
    user_id: &str,
    query: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<serde_json::Value>, sqlx::Error> {
    let search_pattern = format!("%{}%", query);
    
    sqlx::query_as::<_, (String, String, Option<String>, Option<String>, chrono::DateTime<chrono::Utc>)>(
        r#"
        SELECT 
            f.friend_id AS user_id,
            COALESCE(f.display_name, '') AS display_name,
            COALESCE(f.avatar_url, '') AS avatar_url,
            COALESCE(f.note, '') AS note,
            f.created_at AS since
        FROM friend_relationships f
        WHERE f.user_id = $1
          AND f.status = 'accepted'
          AND (
              f.friend_id ILIKE $2 
              OR f.display_name ILIKE $2
              OR f.note ILIKE $2
          )
        ORDER BY f.display_name ASC
        LIMIT $3 OFFSET $4
        "#,
    )
    .bind(user_id)
    .bind(search_pattern)
    .bind(limit)
    .bind(offset)
    .fetch_all(&*self.pool)
    .await
    .map(|rows| {
        rows.into_iter()
            .map(|(user_id, display_name, avatar_url, note, since)| {
                json!({
                    "user_id": user_id,
                    "display_name": display_name,
                    "avatar_url": avatar_url,
                    "note": note,
                    "since": since.timestamp_millis()
                })
            })
            .collect()
    })
}
```

##### Step 2：后端服务层（`src/services/friend_room_service.rs`）

新增 `search_friends` 方法：

```rust
pub async fn search_friends(
    &self,
    user_id: &str,
    query: &str,
    limit: Option<u32>,
    offset: Option<u32>,
) -> ApiResult<serde_json::Value> {
    let limit = limit.unwrap_or(20).min(100) as i64;
    let offset = offset.unwrap_or(0) as i64;

    let friends = self
        .friend_room
        .search_friends(user_id, query, limit, offset)
        .await
        .map_err(|e| ApiError::internal(format!("Search failed: {}", e)))?;

    Ok(json!({
        "results": friends,
        "total": friends.len(),
        "query": query,
        "limit": limit,
        "offset": offset
    }))
}
```

##### Step 3：后端路由层（`src/web/routes/friend_room.rs`）

新增路由和请求体：

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct SearchFriendsQuery {
    pub q: String,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

async fn search_friends(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
    Query(params): Query<SearchFriendsQuery>,
) -> Result<Json<Value>, ApiError> {
    if params.q.is_empty() || params.q.len() > 256 {
        return Err(ApiError::bad_request(
            "Search query must be between 1 and 256 characters"
        ));
    }

    let result = state
        .services
        .friend_room_service
        .search_friends(&auth_user.user_id, &params.q, params.limit, params.offset)
        .await?;

    Ok(Json(result))
}

// 在 create_friend_room_router 中注册:
// .route("/friends/search", get(search_friends))
```

##### Step 4：生成合约

```bash
cd synapse-rust && cargo build && cd ../matrix-js-sdk && pnpm run contract:sync
```

##### Step 5：前端 SDK（`src/friend/index.ts`）

新增 `searchFriends` 方法：

```typescript
/**
 * 搜索好友（按 user_id / display_name / note）
 *
 * @param query  - 搜索关键词（1-256 字符）
 * @param limit  - 返回条数上限（默认 20，最大 100）
 * @param offset - 分页偏移
 * @returns 搜索结果及总数
 */
async searchFriends(
    query: string,
    limit?: number,
    offset?: number,
): Promise<{
    results: Friend[];
    total: number;
    query: string;
    limit: number;
    offset: number;
}> {
    if (!query || query.trim().length === 0) {
        throw new InvalidParamError("Search query is required");
    }
    if (query.length > 256) {
        throw new InvalidParamError("Search query too long (max 256 characters)");
    }

    const params: Record<string, string | number> = { q: query.trim() };
    if (limit !== undefined) params.limit = Math.min(limit, 100);
    if (offset !== undefined) params.offset = offset;

    const response = await this.client.http.authedRequest<{
        results: Friend[];
        total: number;
        query: string;
        limit: number;
        offset: number;
    }>(Method.Get, "/friends/search", params, undefined, { prefix: ClientPrefix.V1 });

    return response;
}
```

##### Step 6：更新合约文档（`docs/api-contract/friend.md`）

在「好友与请求」表中新增：

```
| GET | `/_matrix/client/v1/friends/search?q={query}&limit={N}&offset={M}` | 搜索好友 |
```

在 SDK 映射表中新增：

```
| `GET /friends/search` | `FriendManager` | `searchFriends()` | ✅ 已封装 |
```

在「后端校验规则」表中新增：

```
| `GET /friends/search` | `q` | `1 <= len <= 256` | ✅ |
```

##### Step 7：单元测试

```typescript
// 正常搜索
it("should search friends by name", async () => {
    const result = await friendManager.searchFriends("alice");
    expect(result.results.length).toBeGreaterThanOrEqual(0);
    expect(result.query).toBe("alice");
});

// 空查询
it("should throw for empty query", async () => {
    await expect(friendManager.searchFriends("")).rejects.toThrow(InvalidParamError);
});

// 超长查询
it("should throw for long query", async () => {
    await expect(friendManager.searchFriends("a".repeat(257))).rejects.toThrow(InvalidParamError);
});

// 分页
it("should respect limit and offset", async () => {
    const result = await friendManager.searchFriends("a", 5, 0);
    expect(result.results.length).toBeLessThanOrEqual(5);
    expect(result.limit).toBe(5);
});
```

#### 2.4 工作量估算

| 步骤 | 工作量 | 负责方 |
|------|:---:|------|
| 后端存储层 | 30min | Rust |
| 后端服务层 | 15min | Rust |
| 后端路由层 + 校验 | 30min | Rust |
| 合约同步 | 5min | DevOps |
| 前端 SDK 方法 | 20min | TS |
| 合约文档更新 | 15min | TS |
| 单元测试 | 20min | TS |
| 集成测试 | 15min | 全栈 |
| **合计** | **~2.5h** | |

---

## 第二部分附：端到端加密（E2EE）兼容性分析

> 分析日期：2026-05-05  
> 分析方法：逐层审查全链路加密状态 + 对比 Matrix E2EE 架构模型

### E2.1 现有好友模块全链路加密现状

| 层级 | 文件 | 加密机制 | 数据传输方式 |
|------|------|:---:|------|
| 前端 SDK | `src/friend/index.ts` | ❌ 零加密引用（全文搜索 `encrypt/crypto/olm/megolm/e2ee` 无结果） | `authedRequest` → HTTPS + Bearer Token |
| 后端路由 | `synapse-rust/src/web/routes/friend_room.rs` | ❌ 无加密变换（handler 直接透传 body/query 到 service 层） | Axum JSON/Query 反序列化 |
| 后端服务 | `synapse-rust/src/services/friend_room_service.rs` | ❌ 无加密处理（28 个方法均为纯业务逻辑） | 直接操作数据库 |
| 后端存储 | `synapse-rust/src/storage/friend_room.rs` | ❌ 数据库列以明文存储 `display_name`、`note`、`avatar_url` | PostgreSQL 明文列 |

**结论：好友模块 4 层全链路均以明文传输和存储，无任何端到端加密。**

### E2.2 Matrix E2EE 架构模型

```
┌─────────────────────────────────────────────────────────────────┐
│                    Matrix 加密分层模型                            │
├──────────────────┬──────────────────┬───────────────────────────┤
│   消息内容层      │   社交图谱层      │   传输层                    │
│   (Room Events)  │   (Friend API)   │   (HTTPS)                  │
├──────────────────┼──────────────────┼───────────────────────────┤
│  ✅ Olm/Megolm   │  ❌ 明文 REST     │  ✅ TLS 1.3               │
│  m.room.encrypted│  authedRequest   │  Bearer Token 认证         │
│  仅限 room scope │  服务器端存储     │  全 API 覆盖               │
└──────────────────┴──────────────────┴───────────────────────────┘
```

Matrix 的 E2EE（Olm/Megolm）是 **room-scoped** 的——它加密房间内的事件（`m.room.encrypted`），加密会话绑定到 room ID + device key。好友数据（friend list、display name、note、group membership）不属于 room event 范畴，它存储于独立的数据库表（`friend_relationships`），通过 REST API 而非事件流访问。

**核心认知：Matrix 协议中，"端到端加密"特指 room 消息层，社交图谱（好友关系）不在 E2EE 范围内。**

### E2.3 DM 创建与加密

唯一与加密相关的代码在 DM 模块的 `createDm` 方法中（[dm/index.ts:L188-L202](file:///Users/ljf/Desktop/hu_ts/matrix-js-sdk/src/dm/index.ts#L188-L202)）：

```typescript
// 创建 DM 时默认启用加密
preset: opts.isEncrypted === false ? "private_chat" : "trusted_private_chat",
// ...
if (opts.isEncrypted !== false) {
    initial_state: [{ type: "m.room.encryption", ... }],
}
```

这确保了 DM **房间内的消息**是加密的，但：
- DM 房间映射（谁和谁是 DM 关系）存储在 `m.direct` account data，明文
- 好友关系（谁和谁是好友）存储在 `friend_relationships` 表，明文
- 好友搜索将在好友关系表上执行 LIKE 查询，服务器能读取所有字段

### E2.4 方案 A 搜索流程逐层加密分析

```
用户输入 "alice" → ──── HTTP GET /friends/search?q=alice ────→
                          │
                          │  ✅ HTTPS 传输加密（TLS 1.3）
                          │  ⚠️ 服务器可见：查询词 "alice"、access token
                          ↓
                      friend_room.rs handler
                          │
                          │  ⚠️ 服务器可见：查询词、认证用户 ID
                          ↓
                      friend_room_service.search_friends()
                          │
                          │  ⚠️ 服务器可见：SQL 查询、所有匹配行的字段
                          ↓
                      PostgreSQL ILIKE 查询
                          │
                          │  ⚠️ 数据库明文：user_id, display_name, note
                          ↓
                      返回匹配结果 → ──── JSON Response ────→ 前端
                          │
                          │  ✅ HTTPS 传输加密
                          │  ⚠️ 服务器完整知晓搜索结果
```

### E2.5 敏感数据泄漏风险矩阵

| 数据字段 | 风险等级 | 说明 |
|---------|:---:|------|
| `user_id` | 🟢 低 | Matrix user ID 本身就是公开标识符，存在于用户目录 |
| `display_name` | 🟢 低 | 用户已选择公开的显示名 |
| `avatar_url` | 🟢 低 | 公开的头像 URL |
| `note`（备注） | 🔴 **高** | 用户自定义备注可能包含敏感信息（"老板""女朋友""欠我500块"），明文存储和搜索 |
| `q`（搜索词） | 🟡 中 | 搜索内容暴露用户意图和行为模式 |
| 搜索结果集 | 🟡 中 | 返回结果暴露用户的好友关系图谱 |

### E2.6 结论

**方案 A 不支持端到端加密。** 但这不是方案 A 的设计缺陷——有以下原因：

1. **与现有架构一致**：当前 `getFriends()`、`getFriendInfo()`、`updateFriendNote()` 等全部 24 个方法均以明文传输，`searchFriends()` 不应区别对待
2. **Matrix 协议限制**：E2EE（Olm/Megolm）是 room-scoped 的，无法直接应用于 REST API 响应体
3. **数据性质决定**：user_id 和 display_name 是 Matrix 的公开身份信息，对其加密没有安全收益
4. **note 字段是唯一的敏感点**：如果 notes 需要保密，应单独处理（见下方建议）

### E2.7 建议

| 优先级 | 建议 | 适用场景 |
|:---:|------|---------|
| 🔴 立即 | 在方案文档和 API 文档中**显式声明**好友模块数据以明文存储和传输 | 安全合规审计 |
| 🟡 中期 | 对 `note` 字段提供 **客户端可选加密**：写入前 `encrypt(localKey, note)` → 存储密文 → 读取后 `decrypt(localKey, note)` → 搜索变为客户端搜索（方案 C 范式） | 有隐私需求的用户 |
| 🟢 长期 | 研究 Matrix MSC（Matrix Spec Change）提案，探索将 friend metadata 纳入 E2EE scope | 协议演进 |

> **对于方案 A 本身，只需补充本分析中 E2.7 的「立即」项即可，无需修改实现代码。**

---

### 3.1 问题分析

`docs/api-contract/generated/modules/friend_room.json` 中的 `synapse_rust_commit` 字段值为 `"0000000000000000000000000000000000000000"`（40 个零的占位符）。

**链路跟踪：**
1. `pnpm run contract:sync` → `scripts/contract-sync.mjs` 扫描 synapse-rust 生成 manifest
2. manifest 中的 `synapse_rust_commit` 来自 profile 配置文件
3. profile 配置中未设置实际 hash → 默认为全零占位符
4. `pnpm run contract:codegen` → `scripts/sdk-contract-codegen.mjs` 读取 manifest
5. codegen 脚本 L280 已有防御逻辑：`if (manifest.synapse_rust_commit && manifest.synapse_rust_commit !== "0".repeat(40))` — 跳过占位符

**当前 synapse-rust 实际 commit：** `6ba41b535c04a16bfcd77a3e9da6913a5e5b187f`

### 3.2 解决方案对比

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A：手动修复** | 直接在 JSON 中写入实际 commit | 立即生效，零风险 | 下次 sync 会覆盖 |
| **B：同步时自动捕获** | 修改 `contract-sync.mjs`，sync 时读取 git hash | 一次修改永久生效 | 需修改脚本 |
| **C：CI 注入** | CI 流程中在 sync 前设置环境变量/配置 | 自动化 | 依赖 CI 配置 |
| **D：Git Hook** | pre-sync hook 自动更新 | 本地开发友好 | 需配置 hook |

### 3.3 推荐方案：A + B 组合

1. **立即修复（方案 A）**：直接更新 `friend_room.json` 中的 hash
2. **长期修复（方案 B）**：修改 `contract-sync.mjs`，在生成 manifest 时自动从 `synapse-rust/.git` 读取 HEAD

#### 立即修复

```bash
# 当前 commit
SYNAPSE_COMMIT=$(cd /Users/ljf/Desktop/hu_ts/synapse-rust && git rev-parse HEAD)
echo $SYNAPSE_COMMIT
# 6ba41b535c04a16bfcd77a3e9da6913a5e5b187f

# 写入 friend_room.json（使用 node 脚本更新 JSON）
node -e "
const fs = require('fs');
const p = 'docs/api-contract/generated/modules/friend_room.json';
const data = JSON.parse(fs.readFileSync(p, 'utf8'));
data.synapse_rust_commit = '$SYNAPSE_COMMIT';
fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
console.log('Updated synapse_rust_commit to', data.synapse_rust_commit);
"
```

#### 长期修复：修改 `contract-sync.mjs`

在 `contract-sync.mjs` 中新增函数（约在 L100 附近）：

```javascript
function detectSynapseRustCommit() {
    const synapseRustRoot = process.env.SYNAPSE_RUST_ROOT 
        || path.resolve(repoRoot, "..", "synapse-rust");
    
    try {
        const head = cp.execSync("git rev-parse HEAD", {
            cwd: synapseRustRoot,
            encoding: "utf8",
        }).trim();
        
        if (/^[0-9a-f]{40}$/.test(head)) {
            return head;
        }
    } catch {
        // git not available — use env fallback
        if (process.env.SYNAPSE_RUST_COMMIT) {
            return process.env.SYNAPSE_RUST_COMMIT;
        }
    }
    return null;
}
```

然后在生成 manifest 时使用（约在 L216）：

```javascript
// 原代码：
// synapse_rust_commit: profiles.default.parsed.synapse_rust_commit ?? null,

// 修改为：
synapse_rust_commit: 
    profiles.default.parsed.synapse_rust_commit 
        && profiles.default.parsed.synapse_rust_commit !== "0".repeat(40)
    ? profiles.default.parsed.synapse_rust_commit
    : detectSynapseRustCommit(),
```

### 3.4 是否影响其他模块

检查所有生成模块的 commit hash 状态：

```bash
grep -l "0000000000000000000000000000000000000000" docs/api-contract/generated/modules/*.json
```

如果其他模块也有占位符，需批量修复。

---

## 第四部分：执行计划

### 阶段 1：立即修复（今日完成）

| 任务 | 命令/操作 |
|------|----------|
| ✅ 修复 `friend_room.json` commit hash | 直接替换 + 运行 `codegen --check` |
| ✅ 运行全量 friend 测试 | `vitest run spec/unit/friend.spec.ts` |

### 阶段 2：好友搜索实现（1 次迭代）

| 排序 | 任务 | 依赖 |
|:---:|------|------|
| 1 | 后端存储层 `search_friends` | — |
| 2 | 后端服务层 `search_friends` | 1 |
| 3 | 后端路由层 `GET /friends/search` | 2 |
| 4 | `contract:sync` 生成新合约 | 3 |
| 5 | `contract:codegen` 生成路由表 | 4 |
| 6 | 前端 SDK `searchFriends()` 方法 | 5 |
| 7 | 更新 `friend.md` 合约文档 | 5 |
| 8 | 单元测试 | 6 |
| 9 | 集成测试 | 8 |

### 阶段 3：Commit Hash 长期修复

| 任务 | 说明 |
|------|------|
| 修改 `contract-sync.mjs` | 新增 `detectSynapseRustCommit()` 函数 |
| 验证修复 | 运行 `contract:sync` 确认 hash 正确写入 |
| 批量修复其他模块 | `grep` 找到所有占位符并逐个修复 |
