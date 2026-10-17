---
module: tags
generated_from: docs/api-contract/generated/modules/tags.json
generated_hash: sha256-b751dcc673f04e29a3dbd4164dd038f6e53a9c81d605931b4de0c824817c1d1e
ledger_schema: 4
last_reviewed: 2026-10-14
---

# 标签契约

> **审计状态**: ✅ `RoomManager` / `MatrixClient` 标签入口与独立 `TagManager` 已绑定生成 `TagsPathPattern`
>
> 审查来源: `synapse-rust/synapse-web/src/routes/tags.rs`（**注意**：早先本页写的是 `room.rs` 的 tags section，
> 且路径漏了 `/user/{user_id}` 前缀、还带着已退役的 `r0`；2026-10-14 按后端 `create_tags_router` 与
> `docs/api-contract/generated/modules/tags.json` 订正为下表 4 条。）

## 真实后端路由

| 方法   | 路径                                                           | 说明                       | 认证 |
| ------ | -------------------------------------------------------------- | -------------------------- | ---- |
| GET    | `/_matrix/client/v3/user/{user_id}/tags`                       | 获取全局标签（按房间分组） | 用户 |
| GET    | `/_matrix/client/v3/user/{user_id}/rooms/{room_id}/tags`       | 获取房间标签               | 用户 |
| PUT    | `/_matrix/client/v3/user/{user_id}/rooms/{room_id}/tags/{tag}` | 设置房间标签               | 用户 |
| DELETE | `/_matrix/client/v3/user/{user_id}/rooms/{room_id}/tags/{tag}` | 删除房间标签               | 用户 |

## 结构化类型（codegen 源）

> 本节是 `scripts/sdk-contract-codegen.mjs` 的 DTO 提取源。这些接口是
> `src/tags/__generated__/dto.ts` 的单一权威。
> 形状逐条对照 `synapse-rust/synapse-web/src/routes/tags.rs` 的处理器实现，**不凭印象**：
> `get_tags` / `get_global_tags` 用 `tag.order.unwrap_or(0.0)` 组装响应 ⇒ **`order` 在响应里恒存在**，
> 故 `TagEntry.order` 是必填（而 `src/tags/index.ts` 里手写的 `IRoomTags` 一直写的是 `order?:`，
> 比后端**宽松**——这正是本机制要消除的人肉同步）；`put_tag` / `delete_tag` 返回 `empty_json()` ⇒ `{}`。

```typescript
/** 单个标签的元数据（`rooms/{room_id}/tags` 下每个标签一项）。 */
export interface TagEntry {
    /** 排序权重。后端 `unwrap_or(0.0)` ⇒ 响应中恒有。 */
    order: number;
}

/** `GET /_matrix/client/v3/user/{user_id}/rooms/{room_id}/tags` 响应。 */
export interface RoomTagsResponse {
    tags: Record<string, TagEntry>;
}

/** `GET /_matrix/client/v3/user/{user_id}/tags` 响应：`room_id → tag → TagEntry`。 */
export interface GlobalTagsResponse {
    tags: Record<string, Record<string, TagEntry>>;
}

/** `PUT /_matrix/client/v3/user/{user_id}/rooms/{room_id}/tags/{tag}` 请求体（后端 `TagContent`）。 */
export interface PutTagRequest {
    order?: number;
}

/** `PUT` / `DELETE .../tags/{tag}` 的响应（后端 `empty_json()`）。 */
export type TagWriteResponse = Record<string, never>;
```

## SDK 对齐状态

| 端点                 | SDK Manager    | 方法              | 状态      |
| -------------------- | -------------- | ----------------- | --------- |
| `GET /tags`          | `MatrixClient` | `getRoomTags()`   | ✅ 已封装 |
| `PUT /tags/{tag}`    | `MatrixClient` | `setRoomTag()`    | ✅ 已封装 |
| `DELETE /tags/{tag}` | `MatrixClient` | `deleteRoomTag()` | ✅ 已封装 |

## 常见状态码

| 状态码 | 说明                             |
| ------ | -------------------------------- |
| `200`  | 请求成功                         |
| `400`  | 标签名、排序值或请求体格式非法   |
| `401`  | Token 无效或缺失                 |
| `403`  | 非房间成员或无权修改目标房间标签 |
| `404`  | 房间或标签不存在                 |
| `429`  | 触发限流                         |

## 错误语义对齐（BaseManager）

| 场景                | HTTP / errcode                         | SDK 统一错误类型 | 调用方建议                           |
| ------------------- | -------------------------------------- | ---------------- | ------------------------------------ |
| 未认证或 token 失效 | `401` / `M_UNKNOWN_TOKEN`              | `AuthError`      | 引导重新登录                         |
| 标签参数不合法      | `400` / `M_BAD_JSON` `M_INVALID_PARAM` | `ApiError`       | 修正标签名、`order` 或请求体后重试   |
| 权限不足            | `403` / `M_FORBIDDEN`                  | `ApiError`       | 提示用户需要对应房间访问权限         |
| 房间或标签不存在    | `404` / `M_NOT_FOUND`                  | `NotFoundError`  | 刷新本地标签状态后再决定是否重试     |
| 限流或短暂服务异常  | `429` / `M_LIMIT_EXCEEDED`             | `RetryableError` | 使用退避重试                         |
| 其他 API 错误       | 其他 `4xx/5xx`                         | `ApiError`       | 按 `code` 与 `statusCode` 做兜底处理 |

## 典型 errcode

| errcode            | 常见 HTTP | 说明                          |
| ------------------ | --------- | ----------------------------- |
| `M_UNKNOWN_TOKEN`  | `401`     | access token 无效、过期或缺失 |
| `M_BAD_JSON`       | `400`     | 标签请求体结构不符合接口要求  |
| `M_INVALID_PARAM`  | `400`     | 标签名或 `order` 参数非法     |
| `M_FORBIDDEN`      | `403`     | 无权读取或写入该房间标签      |
| `M_NOT_FOUND`      | `404`     | 房间或指定标签不存在          |
| `M_LIMIT_EXCEEDED` | `429`     | 标签相关请求触发限流          |

## SDK 对齐结论

- `src/room/RoomManager.ts` 中的 `getRoomTags()`、`setRoomTag()`、`deleteRoomTag()` 已绑定生成的 `TagsPathPattern`，因此 `MatrixClient` 对外暴露的同名入口也一并纳入契约约束。
- `src/tags/index.ts` 中的独立 `TagManager` 读取、写入、删除标签路径同样绑定到 `TagsPathPattern`，保留既有缓存、事件和 fallback 语义不变。
- `spec/unit/room-manager.spec.ts` 与 `spec/unit/tags.spec.ts` 已补充显式路径断言，覆盖 `GET /tags`、`PUT /tags/{tag}`、`DELETE /tags/{tag}` 的 v3 主路径调用。

## 覆盖率口径

- **Ledger 契约端点数**: 8
- **SDK 主路径覆盖**: 8/8
- **已绑定生成路由模板**: 8/8
- **契约覆盖率**: 100%

## 实现口径补充（2026-10-17 后端契约回灌）

> 依据：`synapse-rust/docs/sdk/sync.md`（Account Data 与 Tags 一节）与
> `synapse-rust/synapse-web/src/routes/tags.rs`。本节只补充口径，不覆盖上文既有路由表行与统计数字。

### `order` 与排序语义

- `TagEntry.order` 在响应中**恒存在**：后端 `get_tags` / `get_global_tags` 使用 `tag.order.unwrap_or(0.0)`，
  写入时缺省 `order` 也会以 `NULL` 落库并在读取时归一成 `0.0`。
- `m.favourite` 的 `order` 通常取 `0.5` 附近；`m.lowpriority` 与自定义 `u.*` 标签同样只靠 `order` 表达优先级。
- 侧边栏（房间列表）按 `order` **升序**排列，数值越小越靠前；客户端不应自行按标签名或房间名二次排序。

### 改序后的回推路径

- 客户端 `PUT .../tags/{tag}` 改序后，服务端会以 `m.tag` 账户数据经 `/sync` 的
  `account_data.events` 推回（房间级标签走对应房间的 `account_data.events`）。
- 因此本地标签状态应以 `/sync` 回推为准，而不是仅依赖 `PUT` 的 `{}` 响应推断最终顺序。

### 删除幂等

- `DELETE .../tags/{tag}` 对不存在的标签也返回 `{}` + `200`，**不是 `404`**；上文状态码表中的 `404`
  仅适用于房间不存在等场景，不适用于标签删除。
- `PUT .../tags/{tag}` 通过 `(user_id, room_id, tag)` upsert，重复写入同一标签不会报冲突。
