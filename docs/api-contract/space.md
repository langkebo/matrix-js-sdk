---
module: space
generated_from: docs/api-contract/generated/modules/space.json
generated_hash: sha256-37c48352aa2ec402d4efc9c15aee94735b1d2b34fb42d6a34e3cd101af159043
ledger_schema: 1
last_reviewed: 2026-05-03
---

# Space 模块契约

> 审查来源: `synapse-rust/src/web/routes/space.rs`、`space/lifecycle_query.rs`、`space/children_hierarchy.rs`、`space/membership_state.rs`、`space/summary.rs`、`space/types.rs`
> 更新日期: 2026-04-27
> 审计状态: ✅ 核心 `spaces/*` 路由族已与 SDK 对齐，SDK 默认收敛到 `v3` 主路径

## 挂载版本

`create_space_router()` 将同一套路由同时挂到以下前缀：

| 前缀                 | 说明                               |
| -------------------- | ---------------------------------- |
| `/_matrix/client/v1` | 与 `r0/v3` 共用同一组 space 处理器 |
| `/_matrix/client/r0` | 与 `v1/v3` 共用同一组 space 处理器 |
| `/_matrix/client/v3` | 与 `v1/r0` 共用同一组 space 处理器 |

## 认证规则

| 场景         | 实际要求                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| 公开只读接口 | `GET /spaces/public` 无认证；私有 space 可见性由 `OptionalAuthenticatedUser` + `ensure_space_visible()` 决定 |
| 私有只读接口 | 未登录访问私有 space 返回 `401`；已登录但无权限返回 `403`                                                    |
| 写接口       | 创建、更新、删除、加子房间、邀请、加入、离开均要求 `AuthenticatedUser`                                       |
| 搜索接口     | `GET /spaces/search` 要求 `AuthenticatedUser`，后端会把当前用户 ID 传给 `space_service.search_spaces()`      |

## 路由总表

| 方法     | 路径                                                                 | 认证                      | 请求参数/请求体                                                                                                              | 实际响应                                                             |
| -------- | -------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `POST`   | `/_matrix/client/{v1,r0,v3}/spaces`                                  | `AuthenticatedUser`       | `CreateSpaceBody`：`room_id` 必填；`name?` `topic?` `avatar_url?` `join_rule?` `visibility?` `is_public?` `parent_space_id?` | `201` + `SpaceResponse`                                              |
| `GET`    | `/_matrix/client/{v1,r0,v3}/spaces/public`                           | 无                        | `limit?` 默认 `100`，`offset?` 默认 `0`                                                                                      | `200` + `SpaceResponse[]`                                            |
| `GET`    | `/_matrix/client/{v1,r0,v3}/spaces/search`                           | `AuthenticatedUser`       | 查询参数 `query`，支持别名 `search_term`；`limit?` 默认 `10`                                                                 | `200` + `SpaceResponse[]`                                            |
| `GET`    | `/_matrix/client/{v1,r0,v3}/spaces/statistics`                       | 可匿名                    | 无                                                                                                                           | `200` + `serde_json::Value[]`，仅返回当前调用方可见 space 的统计条目 |
| `GET`    | `/_matrix/client/{v1,r0,v3}/spaces/user`                             | `AuthenticatedUser`       | 无                                                                                                                           | `200` + `SpaceResponse[]`                                            |
| `GET`    | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}`                       | 可匿名读公开 space        | 路径参数 `space_id`                                                                                                          | `200` + `SpaceResponse`                                              |
| `PUT`    | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}`                       | `AuthenticatedUser`       | `UpdateSpaceBody`：`name?` `topic?` `avatar_url?` `join_rule?` `visibility?` `is_public?`                                    | `200` + `SpaceResponse`                                              |
| `DELETE` | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}`                       | `AuthenticatedUser`       | 路径参数 `space_id`                                                                                                          | `204 No Content`                                                     |
| `GET`    | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/children`              | 可匿名读公开 space        | 无                                                                                                                           | `200` + `SpaceChildResponse[]`                                       |
| `POST`   | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/children`              | `AuthenticatedUser`       | `AddChildBody`：`room_id` 必填，`via_servers` 为字符串数组，`suggested?` 默认 `false`                                        | `201` + `SpaceChildResponse`                                         |
| `DELETE` | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/children/{room_id}`    | `AuthenticatedUser`       | 路径参数 `space_id`、`room_id`                                                                                               | `204 No Content`                                                     |
| `GET`    | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/hierarchy`             | 可匿名读公开 space        | 查询参数仅消费 `max_depth?`，默认 `1`                                                                                        | `200` + `SpaceHierarchyResponse`                                     |
| `GET`    | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/hierarchy/v1`          | 可匿名读公开 space        | `max_depth?` 默认 `1`，`suggested_only?` 默认 `false`，并透传 `limit?`、`from?`                                              | `200` + service 直接序列化结果                                       |
| `GET`    | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/tree_path`             | 可匿名读公开 space        | 路径参数 `space_id`                                                                                                          | `200` + `SpaceResponse[]`                                            |
| `GET`    | `/_matrix/client/{v1,r0,v3}/spaces/room/{room_id}/parents`           | 可匿名读公开 parent space | 路径参数 `room_id`                                                                                                           | `200` + `SpaceResponse[]`                                            |
| `GET`    | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/members`               | 可匿名读公开 space        | 路径参数 `space_id`                                                                                                          | `200` + `SpaceMemberResponse[]`                                      |
| `GET`    | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/rooms`                 | 可匿名读公开 space        | 路径参数 `space_id`                                                                                                          | `200` + `{ "space_id": string, "rooms": string[] }`                  |
| `GET`    | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/state`                 | 可匿名读公开 space        | 路径参数 `space_id`                                                                                                          | `200` + service 直接序列化的状态对象                                 |
| `POST`   | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/invite`                | `AuthenticatedUser`       | `InviteUserBody`：`user_id` 必填                                                                                             | `201` + `SpaceMemberResponse`                                        |
| `POST`   | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/join`                  | `AuthenticatedUser`       | 无 body                                                                                                                      | `200` + `SpaceMemberResponse`                                        |
| `POST`   | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/leave`                 | `AuthenticatedUser`       | 无 body                                                                                                                      | `204 No Content`                                                     |
| `GET`    | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/summary`               | 可匿名读公开 space        | 路径参数 `space_id`                                                                                                          | `200` + summary 对象；不存在时 `404`                                 |
| `GET`    | `/_matrix/client/{v1,r0,v3}/spaces/{space_id}/summary/with_children` | 可匿名读公开 space        | 路径参数 `space_id`                                                                                                          | `200` + service 直接序列化结果                                       |
| `GET`    | `/_matrix/client/{v1,r0,v3}/spaces/room/{room_id}`                   | 可匿名读公开 space        | 路径参数 `room_id`                                                                                                           | `200` + `SpaceResponse`                                              |

## 稳定请求/响应结构

### `SpaceResponse`

```json
{
    "space_id": "space_123",
    "room_id": "!room:example.com",
    "name": "My Space",
    "topic": "optional",
    "avatar_url": "mxc://example.com/avatar",
    "creator": "@alice:example.com",
    "join_rule": "invite",
    "visibility": "private",
    "is_public": false,
    "created_ts": 1710000000000,
    "updated_ts": 1710000100000,
    "parent_space_id": "space_parent"
}
```

### `SpaceChildResponse`

```json
{
    "space_id": "space_123",
    "room_id": "!child:example.com",
    "via_servers": ["example.com"],
    "sender": "@alice:example.com",
    "is_suggested": true,
    "added_ts": 1710000000000
}
```

### `SpaceMemberResponse`

```json
{
    "space_id": "space_123",
    "user_id": "@alice:example.com",
    "membership": "join",
    "joined_ts": 1710000000000,
    "inviter": "@admin:example.com"
}
```

### `SpaceHierarchyResponse`

```json
{
    "space": {
        "space_id": "space_123",
        "room_id": "!space:example.com",
        "join_rule": "invite",
        "is_public": false,
        "creator": "@alice:example.com",
        "created_ts": 1710000000000,
        "updated_ts": null,
        "name": "My Space",
        "topic": null,
        "avatar_url": null,
        "visibility": "private",
        "parent_space_id": null
    },
    "children": [],
    "members": []
}
```

## 校验与业务规则

- `CreateSpaceBody.room_id` 长度 `1..=255`。
- `CreateSpaceBody.name` 最大 `255`；`topic` 最大 `1000`；`avatar_url` 最大 `2048`。
- `join_rule`、`visibility` 最大 `50` 字符。
- `AddChildBody.room_id` 长度 `1..=255`；`via_servers` 中每个元素最大 `100` 字符。
- `HierarchyQuery.max_depth` 在非 `v1` 层级接口中限制为 `1..=20`；`hierarchy/v1` 只做默认值填充，不额外调用 `validator`。
- `search_spaces` 支持 `query` 与 `search_term` 双写法，后端统一映射到 `SearchQuery.query`。
- `ensure_space_visible()` 的分支明确区分未登录访问私有 space (`401`) 与已登录但无权限 (`403`)。

## 错误与兼容性

| 场景                   | 实际返回                                  |
| ---------------------- | ----------------------------------------- |
| 私有 space 未认证访问  | `401`                                     |
| 无权查看或修改 space   | `403`                                     |
| space / summary 不存在 | `404`                                     |
| `validator` 校验失败   | `400`，错误文本前缀为 `Validation error:` |

- 文档只声明 `space/types.rs` 中显式可见的稳定 DTO 字段。
- `GET /summary`、`GET /summary/with_children`、`GET /state`、`GET /statistics`、`GET /hierarchy/v1` 的具体深层字段由 service 直接序列化，当前文档不虚构未在路由层稳定暴露的子字段。
- SDK 侧 `SpaceManager.getSpaceByRoom()` 对应后端 `GET /spaces/room/{room_id}`；若存在 `getRoomSpace()` 等别名，应视为 SDK 兼容封装，不影响后端契约。

## SDK 对齐结论

- `src/space/index.ts` 现已将核心 `/_matrix/client/v3/spaces/*` 路由绑定到生成的 `SpacePathPattern`。
- `createSpace()`、`getSpace()`、`updateSpace()`、`deleteSpace()`、`getPublicSpaces()`、`searchSpaces()`、
  `getSpaceStatistics()`、`getUserSpaces()`、`getSpaceChildren()`、`addChild()`、`removeChild()`、
  `getSpaceMembers()`、`getSpaceRooms()`、`getSpaceState()`、`inviteToSpace()`、`joinSpace()`、
  `leaveSpace()`、`getSpaceHierarchyPage()`、`getSpaceHierarchyV1()`、`getSpaceSummary()`、
  `getSpaceSummaryWithChildren()`、`getSpaceTreePath()`、`getSpaceByRoom()`、`getRoomParentSpaces()`
  已全部走 `v3` 主路径。
- `r0` 与 `v1` 前缀在后端共享同一组处理器，SDK 默认选择 `v3` 作为主链路，因此 72 条展开路由在语义上已收敛为同一套封装。
- `getRoomSpace()` 继续保留为 `getSpaceByRoom()` 的兼容别名，不影响契约覆盖率。

## 覆盖率口径

- **Ledger 展开路由数**: 72
- **语义端点组数**: 24
- **SDK 主路径覆盖**: 24/24
- **契约覆盖率**: 100%

## 代码定位

- 路由装配: `synapse-rust/src/web/routes/space.rs`
- 生命周期/查询: `synapse-rust/src/web/routes/space/lifecycle_query.rs`
- 子房间与层级: `synapse-rust/src/web/routes/space/children_hierarchy.rs`
- 成员与状态: `synapse-rust/src/web/routes/space/membership_state.rs`
- 摘要: `synapse-rust/src/web/routes/space/summary.rs`
- DTO: `synapse-rust/src/web/routes/space/types.rs`
