---
module: relations
generated_from: docs/api-contract/generated/modules/relations.json
generated_hash: sha256-23b0d81344d596d15e80bfc5b5c94babb5fd10ca73af365f8453b969af20b059
ledger_schema: 4
last_reviewed: 2026-05-03
---

# Relations API 契约文档

> 后端代码: `synapse-rust/synapse-web/src/routes/relations.rs`  
> 装配入口: `synapse-rust/synapse-web/src/routes/assembly.rs`  
> 更新日期: 2026-04-27  
> 挂载版本: `v1`, `v3`

## 一、模块概述

### 1.1 功能描述

Relations API 提供事件关系查询功能，支持：

- 查询事件的所有关系（回复、编辑、反应等）
- 按关系类型过滤（`m.replace`、`m.thread`、`m.annotation` 等）
- 分页查询与聚合统计

### 1.2 路由前缀

- `/_matrix/client/{v1,v3}/rooms/{room_id}/relations/{event_id}`
- `/_matrix/client/{v1,v3}/rooms/{room_id}/aggregations/{event_id}`

### 1.3 认证要求

- 所有端点需要 `AuthenticatedUser`
- 需要房间成员权限

## 二、端点详情

### 2.1 查询事件的所有关系

**路径**: `GET /_matrix/client/{v1,v3}/rooms/{room_id}/relations/{event_id}`  
**认证**: `AuthenticatedUser` + 房间成员  
**挂载版本**: `v1`, `v3`

**路径参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| `room_id` | string | 房间 ID |
| `event_id` | string | 目标事件 ID |

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `from` | string | 否 | 分页起始 token |
| `to` | string | 否 | 分页结束 token |
| `limit` | integer | 否 | 返回数量限制（默认 10） |
| `dir` | string | 否 | 方向：`f` (forward) 或 `b` (backward) |

**响应**: `200 OK`

```typescript
interface RelationsResponse {
    chunk: MatrixEvent[];
    next_batch?: string;
    prev_batch?: string;
}
```

### 2.2 按关系类型查询

**路径**: `GET /_matrix/client/{v1,v3}/rooms/{room_id}/relations/{event_id}/{rel_type}`  
**认证**: `AuthenticatedUser` + 房间成员  
**挂载版本**: `v1`, `v3`

**路径参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| `room_id` | string | 房间 ID |
| `event_id` | string | 目标事件 ID |
| `rel_type` | string | 关系类型（如 `m.replace`, `m.thread`, `m.annotation`） |

**查询参数**: 同 2.1

**响应**: `200 OK` - 同 2.1

### 2.3 创建关系事件

**路径**: `PUT /_matrix/vendor/v1/rooms/{room_id}/relations/{event_id}/{rel_type}/{txn_id}`  
**认证**: `AuthenticatedUser` + 房间成员  
**挂载版本**: `vendor/v1`（**非标准端点**：spec 不定义关系写入，客户端应发带 `m.relates_to` 的普通事件；按 ISSUE-13 走 vendor 前缀）  
⚠️ 2026-10 起该端点是**唯一**的写入入口：原先 `PUT` 与 `GET` 共用 `/_matrix/client/{v1,v3}/…/{rel_type}/{event_type}`，是同一条字面路径挂两个方法（axum 归一化路径参数名 ⇒ 无法拆成两条 `.route()`），第 4 段因此被迫叫 `{event_type}` 却被 handler 当 `txn_id` 用。现在 client 4 段路径**只服务 `GET`**。

**路径参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| `room_id` | string | 房间 ID |
| `event_id` | string | 被关联的目标事件 ID（上下文事件） |
| `rel_type` | string | 允许 `m.reference`、`m.replace`、`m.annotation`、`m.thread` |
| `txn_id` | string | 客户端事务 ID，**真的**用于幂等去重：后端用 `room_event_txn_dedup` 记录 `(user, room, txn_id) → event_id`，重放返回同一 `event_id`，不产生第二条关系事件 |

**请求体**:

```json
{
    "content": {
        "body": "edited content",
        "msgtype": "m.text"
    },
    "m.new_content": {
        "body": "edited content",
        "msgtype": "m.text"
    },
    "key": "👍"
}
```

**业务规则**:

- `m.annotation` 从 `key` 读取 reaction key，未提供时后端默认 `"👍"`
- `m.reference` 从 `content` 读取引用事件内容
- `m.replace` 优先读取 `content`，其次回退到 `m.new_content`
- 房间不存在时返回 `404`

**响应**: `200 OK`

```json
{
    "event_id": "$new_event_id",
    "room_id": "!room:example.com",
    "relates_to": {
        "event_id": "$target_event_id",
        "rel_type": "m.replace"
    }
}
```

### 2.4 查询关系聚合

**路径**: `GET /_matrix/client/{v1,v3}/rooms/{room_id}/aggregations/{event_id}/{rel_type}`  
**认证**: `AuthenticatedUser` + 房间成员  
**挂载版本**: `v1`, `v3`

**响应**: `200 OK`

```typescript
interface AggregationsResponse {
    chunk: Array<{
        type: string;
        key: string;
        count: number;
    }>;
}
```

### 2.5 查询事件关系（仅 v1/v3）

**路径**: `GET /_matrix/client/{v1,v3}/rooms/{room_id}/relations/{event_id}`  
**认证**: `AuthenticatedUser` + 房间成员  
**挂载版本**: `v1`, `v3`

**说明**: v1/v3 版本支持更多查询参数和过滤选项

## 三、SDK 对齐状态

### 3.1 SDK Manager 对应关系

| 后端端点                                                  | SDK 方法                                                                | 状态      |
| --------------------------------------------------------- | ----------------------------------------------------------------------- | --------- |
| `GET /relations/{event_id}`                               | `RelationsManager.fetchRelations()` / `MatrixClient.relations()`        | ✅ 已封装 |
| `GET /relations/{event_id}/{rel_type}`                    | `RelationsManager.fetchRelations()` / `MatrixClient.relations()`        | ✅ 已封装 |
| `GET /aggregations/{event_id}/{rel_type}`                 | `RelationsManager.getAggregations()` / `MatrixClient.getAggregations()` | ✅ 已封装 |
| `PUT /relations/{event_id}/{rel_type}/{txn_id}`（vendor） | `RelationsManager.sendRelation()`                                       | ✅ 已封装 |

### 3.2 封装覆盖率

- **总端点数**: 5
- **已封装**: 5
- **覆盖率**: 100%

### 3.3 已知差异

- SDK 的 `relations()` 方法合并了多个后端端点
- `RelationsManager` 现在补齐了 `getAggregations()` 与 `sendRelation()` 两个专用 wrapper；
  `MatrixClient` 侧的通用入口依然保留，用于兼容旧调用方式。

### 3.4 人工 Review 对齐

- `src/relations/index.ts` 已绑定生成的 `route-table` 路径模板，避免手写关系路由继续漂移。
- 新增 `RelationsManager.getAggregations()`，直连 `GET /aggregations/{event_id}/{rel_type}`。
- 新增 `RelationsManager.sendRelation()`，直连 `PUT /relations/{event_id}/{rel_type}/{txn_id}`。
- 单测已覆盖专用聚合查询、专用关系发送和错误归一化行为。

## 四、常见错误码

| 状态码 | 错误码            | 说明             |
| ------ | ----------------- | ---------------- |
| 400    | `M_INVALID_PARAM` | 参数无效         |
| 401    | `M_UNAUTHORIZED`  | 未认证           |
| 403    | `M_FORBIDDEN`     | 非房间成员       |
| 404    | `M_NOT_FOUND`     | 事件或房间不存在 |

## 五、变更历史

| 日期       | 变更                                                                                                                                                                                                                                          | 影响                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 2026-04-27 | 初版                                                                                                                                                                                                                                          | -                                  |
| 2026-05-11 | 补齐 RelationsManager 的聚合查询与关系发送专用封装                                                                                                                                                                                            | 覆盖率更新为 100%                  |
| 2026-10-02 | 关系写入端点拆到 `/_matrix/vendor/v1`（第 4 段为显式 `txn_id`，接 `room_event_txn_dedup` 真幂等）；client 4 段路径只留 `GET`；`sendRelationViaSendRelation` 删除（与 `sendRelation` 重复且 body 形状不符），`sendRelation` 收敛为唯一写入入口 | 写入端点与 `sendRelation` 签名对齐 |

## 实现口径补充（2026-10-17 后端契约回灌）

> 依据：`synapse-rust/docs/sdk/messages.md` 与 `docs/api-contract/generated/modules/relations.json`。
> 本节只补充口径，不覆盖上文既有路由行、端点计数与覆盖率数字。

### 缺失的 `{eventType}` 过滤路由

上文只写到 `/{rel_type}` 两级过滤，实际 ledger 还登记了第三级事件类型过滤（`v1` 与 `v3` 各一条）：

- `GET /_matrix/client/v1/rooms/{room_id}/relations/{event_id}/{rel_type}/{event_type}`
- `GET /_matrix/client/v3/rooms/{room_id}/relations/{event_id}/{rel_type}/{event_type}`

语义是在 `rel_type` 基础上再按事件 `type` 精确过滤（如 `m.room.message`）。查询参数与两级版本一致（`from` / `to` / `limit` / `dir` / `recurse`）。

### `recurse`（MSC3981）

- 所有 relations 读取端点额外接受 `recurse` 查询参数（布尔），用于递归展开子关系。
- 该参数只影响读取结果集合，不改变写入端点；不传时按非递归处理。

### 聚合响应的固定形状

- `GET /{room_id}/aggregations/{event_id}/{rel_type}` 的响应**没有 `next_batch`**，聚合是一次性返回的，不要按分页接口重试翻页。
- `chunk[]` 元素 `type` 固定为 `m.annotation`，`key` 为 annotation 键，`count` 为去重后的发送者数。
- 聚合列表中的 `sender` 与 `origin_server_ts` 为 `null`；它们只在某些内部单条聚合视图下填充，客户端不应依赖这两个字段。

### `txn_id` 幂等键口径待确认

- 本页 2.3 写的是 `(user, room, txn_id) → event_id`（`room_event_txn_dedup`）。
- 后端 `docs/sdk/messages.md` 对发送路径写的是 `(user, device, txn_id, event_type)`。
- 两处描述不一致，尚未确认关系写入是否也按设备与事件类型分桶。在确认前，客户端重试应**同时保持 `txn_id`、`event_type` 与设备不变**，避免依赖单一维度导致重复写入。
