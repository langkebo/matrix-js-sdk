---
module: federation
generated_from: docs/api-contract/generated/modules/federation.json
generated_hash: sha256-88ba1f80ad99095463fbf98eb5d1257a77f9fb73ccb6d68153503c4e63f9f865
ledger_schema: 4
last_reviewed: 2026-05-03
---

# Federation 模块契约

> 审查来源: `synapse-rust/synapse-web/src/routes/federation/mod.rs`
> 挂载版本: `federation v1/v2`、`key v2`
> 更新日期: 2026-04-13

## 认证模型

- Public federation 路由无需联邦签名中间件。
- Protected federation 路由统一套用 `federation_auth_middleware`，要求 `Authorization: X-Matrix ...` 签名认证。
- 这组接口不使用普通客户端 access token。

## Public Federation

| 方法 | 路径                                                  | 说明               |
| ---- | ----------------------------------------------------- | ------------------ |
| GET  | `/_matrix/federation/v2/server`                       | 获取服务端签名 key |
| GET  | `/_matrix/key/v2/server`                              | 获取服务端签名 key |
| GET  | `/_matrix/federation/v2/query/{server_name}/{key_id}` | key 查询           |
| GET  | `/_matrix/key/v2/query/{server_name}/{key_id}`        | key 查询           |
| GET  | `/_matrix/federation/v1/version`                      | 联邦版本信息       |
| GET  | `/_matrix/federation/v1`                              | 联邦发现信息       |
| GET  | `/_matrix/federation/v1/publicRooms`                  | 联邦公开房间列表   |
| GET  | `/_matrix/federation/v1/hierarchy/{room_id}`          | 房间层级           |
| GET  | `/_matrix/federation/v1/query/destination`            | 目的地查询         |
| GET  | `/_matrix/federation/v1/room/{room_id}/{event_id}`    | 获取房间事件       |

## Protected Federation

| 方法 | 路径                                                              | 说明                    |
| ---- | ----------------------------------------------------------------- | ----------------------- |
| GET  | `/_matrix/federation/v1/members/{room_id}`                        | 获取成员                |
| GET  | `/_matrix/federation/v1/members/{room_id}/joined`                 | 获取已加入成员          |
| GET  | `/_matrix/federation/v1/user/devices/{user_id}`                   | 获取用户设备            |
| GET  | `/_matrix/federation/v1/room_auth/{room_id}`                      | 获取房间鉴权事件        |
| PUT  | `/_matrix/federation/v1/knock/{room_id}/{user_id}`                | federation knock        |
| POST | `/_matrix/federation/v1/thirdparty/invite`                        | 第三方邀请              |
| GET  | `/_matrix/federation/v1/get_joining_rules/{room_id}`              | 获取 join 规则          |
| PUT  | `/_matrix/federation/v2/invite/{room_id}/{event_id}`              | v2 invite               |
| PUT  | `/_matrix/federation/v1/send/{txn_id}`                            | 发送联邦事务            |
| GET  | `/_matrix/federation/v1/make_join/{room_id}/{user_id}`            | make join               |
| GET  | `/_matrix/federation/v1/make_leave/{room_id}/{user_id}`           | make leave              |
| PUT  | `/_matrix/federation/v1/send_join/{room_id}/{event_id}`           | send join v1            |
| PUT  | `/_matrix/federation/v2/send_join/{room_id}/{event_id}`           | send join v2            |
| PUT  | `/_matrix/federation/v1/send_leave/{room_id}/{event_id}`          | send leave v1           |
| PUT  | `/_matrix/federation/v2/send_leave/{room_id}/{event_id}`          | send leave v2           |
| PUT  | `/_matrix/federation/v1/invite/{room_id}/{event_id}`              | invite v1               |
| POST | `/_matrix/federation/v1/get_missing_events/{room_id}`             | 获取缺失事件            |
| GET  | `/_matrix/federation/v1/timestamp_to_event/{room_id}`             | 时间戳转事件            |
| GET  | `/_matrix/federation/v1/get_event_auth/{room_id}/{event_id}`      | 事件鉴权链              |
| GET  | `/_synapse/federation/v1/query/auth`                              | query auth              |
| GET  | `/_matrix/federation/v1/get_event_auth/{room_id}/{event_id}`      | event auth              |
| GET  | `/_matrix/federation/v1/state/{room_id}`                          | 房间状态                |
| GET  | `/_matrix/federation/v1/event/{event_id}`                         | 事件详情                |
| GET  | `/_matrix/federation/v1/state_ids/{room_id}`                      | 状态 ID 列表            |
| GET  | `/_matrix/federation/v1/query/directory/room/{room_id}`           | 目录查询                |
| GET  | `/_matrix/federation/v1/query/profile/{user_id}`                  | profile 查询            |
| GET  | `/_matrix/federation/v1/backfill/{room_id}`                       | backfill                |
| POST | `/_matrix/federation/v1/user/keys/claim`                          | claim keys              |
| POST | `/_matrix/federation/v1/user/keys/query`                          | query keys              |
| POST | `/_matrix/federation/v1/user/keys/upload`                         | upload keys             |
| POST | `/_synapse/federation/v2/key/clone`                               | key clone               |
| POST | `/_matrix/federation/v2/user/keys/query`                          | user keys query         |
| POST | `/_matrix/federation/v1/publicRooms`                              | 联邦公开房间查询        |
| GET  | `/_matrix/federation/v1/query/directory`                          | 目录查询                |
| GET  | `/_matrix/federation/v1/openid/userinfo`                          | OpenID userinfo         |
| GET  | `/_matrix/federation/v1/media/download/{server_name}/{media_id}`  | 联邦媒体下载            |
| GET  | `/_matrix/federation/v1/media/thumbnail/{server_name}/{media_id}` | 联邦缩略图              |
| PUT  | `/_matrix/federation/v1/exchange_third_party_invite/{room_id}`    | 交换第三方邀请          |
| GET  | `/_matrix/federation/v1/groups/{group_id}`                        | 兼容 communities/groups |

## SDK 契约对齐

- **后端 Ledger 路由总数**: 55
- **SDK 已封装路由数**: 19
- **契约覆盖率**: 35%
- **口径说明（2026-10-15 订正）**: 原写「总数 52 / 覆盖率 37%」为陈旧值（52 系后端补齐 3 条前的计数；
  19/55 = 34.5% ≈ 35%）。**更关键的是口径本身**：本模块 55 条**全部**为 server-to-server / key-server
  路由（`_matrix/federation/v1` 36 + `v2` 7 + `unstable` 1、`_synapse/federation/*` 7、`_matrix/key/v2` 4，
  逐条实测**无**任何 `/_matrix/client/*` 或 `/_synapse/admin/*` 混入），由 homeserver 之间与 key server
  调用，**客户端 SDK 天然不承担**。故本模块已由 `quality:manager-codegen` 从 `WAIVED` 移入新增的
  `SERVER_ONLY_MODULES` 类别 —— 属「本口径不适用」，而非「有期限的欠账」。
  此处 35% 只作**事实记录**，不是待办 KPI。
- **说明**: `FederationManager` 已补齐联邦发现、目的地查询、跨服事件与跨服媒体读接口，手写路径漂移面继续收敛；大量 Protected Federation 路由、Key 相关的 V2 路由主要用于服务器间交互，SDK 仅保留最核心的客户端可见面。
- **v10 对齐 (2026-06-09)**: 新增 `toCanonicalJson()` 静态方法（转义 U+2028/U+2029/U+FFFD 字符，对齐后端 C-2 Canonical JSON 修复）；新增 `sendFederationEvent()` 方法（使用 Canonical JSON 序列化发送联邦事件）。

### 已封装方法

| SDK 方法                      | 路径                                                                            | 认证         |
| ----------------------------- | ------------------------------------------------------------------------------- | ------------ |
| `getBlacklist()`              | `GET /_synapse/admin/v1/federation/blacklist`                                   | 管理员 token |
| `addToBlacklist()`            | `POST /_synapse/admin/v1/federation/blacklist/{server_name}`                    | 管理员 token |
| `removeFromBlacklist()`       | `DELETE /_synapse/admin/v1/federation/blacklist/{server_name}`                  | 管理员 token |
| `getServerStatus()`           | `GET /_synapse/admin/v1/federation/destinations/{serverName}`                   | 管理员 token |
| `getFederationDestinations()` | `GET /_synapse/admin/v1/federation/destinations`                                | 管理员 token |
| `reconnectServer()`           | `POST /_synapse/admin/v1/federation/destinations/{serverName}/reset_connection` | 管理员 token |
| `getServerVersion()`          | `GET /_matrix/federation/v1/version`                                            | 无           |
| `getPublicRoomsOnServer()`    | `GET /_matrix/federation/v1/publicRooms`                                        | 无           |
| `queryProfile()`              | `GET /_matrix/federation/v1/query/profile/{userId}`                             | 无           |
| `queryDirectory()`            | `GET /_matrix/federation/v1/query/directory`                                    | 无           |
| `getHierarchy()`              | `GET /_matrix/federation/v1/hierarchy/{roomId}`                                 | 无           |
| `getFederationInfo()`         | `GET /_matrix/federation/v1`                                                    | 无           |
| `queryDestination()`          | `GET /_matrix/federation/v1/query/destination`                                  | 无           |
| `getRoomEvent()`              | `GET /_matrix/federation/v1/room/{roomId}/{eventId}`                            | 无           |
| `downloadMedia()`             | `GET /_matrix/federation/v1/media/download/{serverName}/{mediaId}`              | 无           |
| `getMediaThumbnail()`         | `GET /_matrix/federation/v1/media/thumbnail/{serverName}/{mediaId}`             | 无           |
| `sendFederationEvent()`       | `PUT /_matrix/federation/v1/send/{txnId}`                                       | 联邦签名     |

## 实现口径补充（2026-10-17 后端契约回灌）

### 联邦连接管理只有 reset_connection

- `GET /_synapse/admin/v1/federation/status/{server_name}` 后端**没有注册**；
  单个目的端状态改用 `GET /_synapse/admin/v1/federation/destinations/{destination}`。
- `POST /_synapse/admin/v1/federation/disconnect/{server_name}` 与
  `POST /_synapse/admin/v1/federation/reconnect/{server_name}` 后端**都没有注册**；
  唯一写端点是 `POST /_synapse/admin/v1/federation/destinations/{destination}/reset_connection`。
- `reset_connection` 的语义是清空该目的地的重试 / 退避状态、允许立即重试，不是「断开连接」；
  也没有独立的「重连」端点。
- SDK 侧对应：`FederationManager.reconnectServer()` 与
  `AdminManager.resetFederationConnection()` / `resetFederationDestination()`
  都打到 `reset_connection`；`disconnectServer()` 已删除。
- 后端源码注释提到过 `.../reset` 别名，但 ledger 只登记了 `reset_connection`；
  SDK 只应使用登记过的路径。

### blacklist 与 destinations 的响应形状

`GET /_synapse/admin/v1/federation/blacklist`：

```json
{
    "blacklist": [{ "server_name": "bad.example", "added_at": 1759000000000, "reason": null }],
    "total": 1,
    "next_batch": "..."
}
```

- 键名是 `added_at`（不是 `added_ts`），`reason` 可为 `null`。

`GET /_synapse/admin/v1/federation/destinations`：

```json
{
    "destinations": [
        {
            "destination": "matrix.org",
            "retry_last_ts": null,
            "retry_interval": null,
            "failure_ts": null,
            "last_successful_ts": 1759000000000,
            "failure_count": 0,
            "status": "active",
            "updated_ts": 1759000000000
        }
    ],
    "total": 1,
    "total_count": 1,
    "next_batch": "..."
}
```

- `retry_interval` 后端写死 `None`，恒为 `null`。
- 上游 Synapse 的 `last_successful_stream_ordering` 本后端不返回，真实字段是
  `last_successful_ts` + `failure_count`。
- `GET /federation/destinations/{destination}/rooms` 的元素是**房间 id 字符串**，不是对象。

### 请求体 `deny_unknown_fields`

`POST /federation/confirm`、`POST /federation/resolve`、`POST /federation/rewrite` 的请求体
都带 `deny_unknown_fields`，字段名必须完全一致，否则 400：

- `ConfirmRequest {server_name, accept}`
- `ResolveRequest {server_name}`
- `RewriteRequest {from, to}`

列表 query 只认 `limit` / `from`；`DestinationsQuery` 另外接受 `offset`，但**非 0 即 400**。

### 管理路由归属

本页「已封装方法」中的管理员端点实际登记在 **`generated/modules/admin.json`**，
不在 `federation.json`。`federation.json` 只包含 `_matrix/federation/*`、`_matrix/key/*`
与 `_synapse/federation/*` 的 server-to-server 路由，因此本模块覆盖率不因管理端点而提高。
