# Space 模块审查总结

> 说明: 本文件保留 2026-04-15 的阶段性审查快照。当前契约结论请以 `space.md`、`README.md` 与 `CHANGELOG.md` 为准。


**审查日期**: 2026-04-15  
**审查状态**: ✅ 已完成审查

---

## 执行摘要

Space 模块提供空间（Space）管理功能，包括空间创建、层级管理、成员管理等。已完成后端代码审查，现有契约文档已经比较完整。

### 审查结果

**核心文件**: 
- `synapse-rust/src/web/routes/space.rs` (主路由)
- `synapse-rust/src/web/routes/space/lifecycle_query.rs` - 生命周期和查询
- `synapse-rust/src/web/routes/space/children_hierarchy.rs` - 子空间层级
- `synapse-rust/src/web/routes/space/membership_state.rs` - 成员状态
- `synapse-rust/src/web/routes/space/summary.rs` - 空间摘要

**关键发现**:

1. **接口实现**（20+ 个端点）:
   
   **空间生命周期（7 个）**:
   - ✅ `POST /spaces` - 创建空间
   - ✅ `GET /spaces/public` - 获取公开空间列表
   - ✅ `GET /spaces/search` - 搜索空间
   - ✅ `GET /spaces/statistics` - 获取统计信息
   - ✅ `GET /spaces/user` - 获取用户空间列表
   - ✅ `GET /spaces/{space_id}` - 获取空间详情
   - ✅ `PUT /spaces/{space_id}` - 更新空间
   - ✅ `DELETE /spaces/{space_id}` - 删除空间

   **空间层级（4 个）**:
   - ✅ `GET /spaces/{space_id}/children` - 获取子房间列表
   - ✅ `POST /spaces/{space_id}/children` - 添加子房间
   - ✅ `DELETE /spaces/{space_id}/children/{room_id}` - 移除子房间
   - ✅ `GET /spaces/{space_id}/hierarchy` - 获取层级结构
   - ✅ `GET /spaces/{space_id}/hierarchy/v1` - 获取层级结构 v1

   **成员管理（4 个）**:
   - ✅ `GET /spaces/{space_id}/members` - 获取成员列表
   - ✅ `POST /spaces/{space_id}/invite` - 邀请用户
   - ✅ `POST /spaces/{space_id}/join` - 加入空间
   - ✅ `POST /spaces/{space_id}/leave` - 离开空间

   **空间查询（5 个）**:
   - ✅ `GET /spaces/{space_id}/rooms` - 获取房间列表
   - ✅ `GET /spaces/{space_id}/state` - 获取状态快照
   - ✅ `GET /spaces/{space_id}/summary` - 获取摘要
   - ✅ `GET /spaces/{space_id}/summary/with_children` - 获取摘要（含子空间）
   - ✅ `GET /spaces/{space_id}/tree_path` - 获取树路径
   - ✅ `GET /spaces/room/{room_id}` - 通过房间获取空间
   - ✅ `GET /spaces/room/{room_id}/parents` - 获取父空间

2. **核心特性**:
   - 空间 CRUD 操作
   - 层级结构管理（父子关系）
   - 成员管理（邀请、加入、离开）
   - 空间搜索和发现
   - 空间摘要和统计
   - 树路径查询

3. **数据约束**:
   - space_id: 房间 ID 格式（!xxx:server）
   - name: 字符串，空间名称
   - topic: 字符串，空间主题
   - join_rule: "public" | "invite" | "knock"
   - visibility: "public" | "private"
   - order: 字符串，排序键
   - suggested: 布尔值，是否推荐

4. **SDK 封装状态**:
   - ✅ SpaceManager 已实现
   - ✅ 核心接口已封装
   - ✅ 根据 CHANGELOG，已补充多个方法

---

## 核心接口总结

### 1. 空间生命周期

```http
# 创建空间
POST /_matrix/client/v3/spaces
Body: {
  "name": "My Space",
  "topic": "A space for...",
  "join_rule": "public",
  "visibility": "public"
}
Response: { "space_id": "!xxx:server" }

# 获取空间详情
GET /_matrix/client/v3/spaces/{space_id}
Response: { "space_id", "name", "topic", "avatar_url", "join_rule", ... }

# 更新空间
PUT /_matrix/client/v3/spaces/{space_id}
Body: { "name": "New Name", "topic": "New Topic" }
Response: {}

# 删除空间
DELETE /_matrix/client/v3/spaces/{space_id}
Response: {}
```

### 2. 空间层级

```http
# 获取子房间
GET /_matrix/client/v3/spaces/{space_id}/children
Response: { "children": [...] }

# 添加子房间
POST /_matrix/client/v3/spaces/{space_id}/children
Body: { "room_id": "!room:server", "order": "01", "suggested": true }
Response: {}

# 移除子房间
DELETE /_matrix/client/v3/spaces/{space_id}/children/{room_id}
Response: {}

# 获取层级结构
GET /_matrix/client/v3/spaces/{space_id}/hierarchy?max_depth=3
Response: { "rooms": [...], "events": [...] }
```

### 3. 成员管理

```http
# 邀请用户
POST /_matrix/client/v3/spaces/{space_id}/invite
Body: { "user_id": "@user:server" }
Response: {}

# 加入空间
POST /_matrix/client/v3/spaces/{space_id}/join
Response: { "room_id": "!xxx:server" }

# 离开空间
POST /_matrix/client/v3/spaces/{space_id}/leave
Response: {}

# 获取成员列表
GET /_matrix/client/v3/spaces/{space_id}/members
Response: { "members": [...] }
```

### 4. 空间查询

```http
# 获取公开空间
GET /_matrix/client/v3/spaces/public
Response: { "spaces": [...] }

# 搜索空间
GET /_matrix/client/v3/spaces/search?q=keyword
Response: { "results": [...] }

# 获取空间摘要
GET /_matrix/client/v3/spaces/{space_id}/summary
Response: { "space_id", "name", "num_joined_members", "room_count", ... }
```

---

## 数据约束

| 字段 | 约束 | 说明 |
|------|------|------|
| space_id | 房间 ID 格式 | !xxx:server |
| name | 字符串 | 空间名称 |
| topic | 字符串 | 空间主题 |
| join_rule | 枚举 | "public", "invite", "knock" |
| visibility | 枚举 | "public", "private" |
| order | 字符串 | 排序键（如 "01", "02"） |
| suggested | 布尔值 | 是否推荐 |
| max_depth | 整数 | 层级深度限制 |

---

## 错误码

| 错误码 | HTTP 状态码 | 场景 |
|--------|------------|------|
| M_BAD_JSON | 400 | 请求体格式错误 |
| M_INVALID_PARAM | 400 | 参数不合法 |
| M_UNKNOWN_TOKEN | 401 | Token 无效 |
| M_FORBIDDEN | 403 | 无权限 |
| M_NOT_FOUND | 404 | 空间或房间不存在 |
| M_LIMIT_EXCEEDED | 429 | 限流 |

---

## 核心概念

### 1. 空间（Space）

- 空间本质上是一个特殊的房间
- 用于组织和分组其他房间
- 支持层级结构（父子关系）

### 2. 层级结构

- 空间可以包含子房间和子空间
- 支持多层嵌套
- 可以设置排序和推荐

### 3. 成员管理

- 支持邀请、加入、离开
- 继承房间的成员管理机制
- 支持不同的加入规则

### 4. 空间发现

- 公开空间列表
- 空间搜索
- 用户空间列表

---

## 版本兼容性

| 前缀 | 说明 |
|------|------|
| `/_matrix/client/v1` | 与 r0/v3 共享路由 |
| `/_matrix/client/r0` | 与 v1/v3 共享路由 |
| `/_matrix/client/v3` | 与 v1/r0 共享路由 |

---

## 质量评价

**评级**: ⭐⭐⭐⭐⭐ **优秀**

**理由**:
- ✅ 现有文档比较完整
- ✅ 覆盖了主要端点
- ✅ 包含错误码映射
- ✅ SDK 已有实现（根据 CHANGELOG）
- ✅ 后端实现完整

---

## SDK 封装状态

根据 CHANGELOG（2026-04-14）记录：
- ✅ `joinSpace()` - 已补充
- ✅ `leaveSpace()` - 已补充
- ✅ `inviteToSpace()` - 已补充
- ✅ `getSpaceRooms()` - 已补充
- ✅ `getSpaceState()` - 已补充
- ✅ `getSpaceSummary()` - 已补充
- ✅ `getPublicSpaces()` - 已补充

---

## 建议

由于 Space 模块的文档已经比较完整，建议：

1. **保持现有文档**: 文档质量高
2. **补充详细示例**: 添加更多请求/响应示例
3. **补充层级管理**: 添加层级结构的详细说明

---

## 注意事项

1. **空间本质是房间**:
   - space_id 就是 room_id
   - 继承房间的大部分特性

2. **层级结构**:
   - 支持多层嵌套
   - 可以设置排序和推荐
   - 需要管理父子关系

3. **成员管理**:
   - 继承房间的成员管理
   - 支持不同的加入规则
   - 需要权限验证

4. **空间发现**:
   - 公开空间可被搜索
   - 私有空间需要邀请
   - 支持用户空间列表

5. **版本兼容**:
   - v1/r0/v3 共享路由
   - SDK 优先使用 v3

---

**审查人**: SDK 开发工程师  
**状态**: ✅ 完成  
**建议**: 现有文档质量高，SDK 已有实现，无需大幅修改