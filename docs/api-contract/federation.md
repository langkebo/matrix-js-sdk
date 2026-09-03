---
module: federation
generated_from: docs/api-contract/generated/modules/federation.json
generated_hash: sha256-70194b663eff58a0359af9242f5d59884e7fb92f16dd413af5b4a08605fe7f9b
ledger_schema: 1
last_reviewed: 2026-05-03
---

# Federation 模块契约

> 审查来源: `synapse-rust/src/web/routes/federation.rs`
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
| GET  | `/_matrix/federation/v1/query/auth`                               | query auth              |
| GET  | `/_matrix/federation/v1/event_auth`                               | event auth              |
| GET  | `/_matrix/federation/v1/state/{room_id}`                          | 房间状态                |
| GET  | `/_matrix/federation/v1/event/{event_id}`                         | 事件详情                |
| GET  | `/_matrix/federation/v1/state_ids/{room_id}`                      | 状态 ID 列表            |
| GET  | `/_matrix/federation/v1/query/directory/room/{room_id}`           | 目录查询                |
| GET  | `/_matrix/federation/v1/query/profile/{user_id}`                  | profile 查询            |
| GET  | `/_matrix/federation/v1/backfill/{room_id}`                       | backfill                |
| POST | `/_matrix/federation/v1/keys/claim`                               | claim keys              |
| POST | `/_matrix/federation/v1/keys/query`                               | query keys              |
| POST | `/_matrix/federation/v1/keys/upload`                              | upload keys             |
| POST | `/_matrix/federation/v2/key/clone`                                | key clone               |
| POST | `/_matrix/federation/v2/user/keys/query`                          | user keys query         |
| POST | `/_matrix/federation/v1/publicRooms`                              | 联邦公开房间查询        |
| GET  | `/_matrix/federation/v1/query/directory`                          | 目录查询                |
| GET  | `/_matrix/federation/v1/openid/userinfo`                          | OpenID userinfo         |
| GET  | `/_matrix/federation/v1/media/download/{server_name}/{media_id}`  | 联邦媒体下载            |
| GET  | `/_matrix/federation/v1/media/thumbnail/{server_name}/{media_id}` | 联邦缩略图              |
| PUT  | `/_matrix/federation/v1/exchange_third_party_invite/{room_id}`    | 交换第三方邀请          |
| GET  | `/_matrix/federation/v1/groups/{group_id}`                        | 兼容 communities/groups |

## SDK 契约对齐

- **后端 Ledger 路由总数**: 52
- **SDK 已封装路由数**: 19
- **契约覆盖率**: 37%
- **说明**: `FederationManager` 已补齐联邦发现、目的地查询、跨服事件与跨服媒体读接口，手写路径漂移面继续收敛；大量 Protected Federation 路由、Key 相关的 V2 路由主要用于服务器间交互，SDK 仅保留最核心的客户端可见面。
- **v10 对齐 (2026-06-09)**: 新增 `toCanonicalJson()` 静态方法（转义 U+2028/U+2029/U+FFFD 字符，对齐后端 C-2 Canonical JSON 修复）；新增 `sendFederationEvent()` 方法（使用 Canonical JSON 序列化发送联邦事件）。

### 已封装方法

| SDK 方法                      | 路径                                                                | 认证         |
| ----------------------------- | ------------------------------------------------------------------- | ------------ |
| `getBlacklist()`              | `GET /_synapse/admin/v1/federation/blacklist`                       | 管理员 token |
| `addToBlacklist()`            | `POST /_synapse/admin/v1/federation/blacklist/add`                  | 管理员 token |
| `removeFromBlacklist()`       | `POST /_synapse/admin/v1/federation/blacklist/remove`               | 管理员 token |
| `getServerStatus()`           | `GET /_synapse/admin/v1/federation/status/{serverName}`             | 管理员 token |
| `getFederationDestinations()` | `GET /_synapse/admin/v1/federation/destinations`                    | 管理员 token |
| `disconnectServer()`          | `POST /_synapse/admin/v1/federation/disconnect/{serverName}`        | 管理员 token |
| `reconnectServer()`           | `POST /_synapse/admin/v1/federation/reconnect/{serverName}`         | 管理员 token |
| `getServerVersion()`          | `GET /_matrix/federation/v1/version`                                | 无           |
| `getPublicRoomsOnServer()`    | `GET /_matrix/federation/v1/publicRooms`                            | 无           |
| `queryProfile()`              | `GET /_matrix/federation/v1/query/profile/{userId}`                 | 无           |
| `queryDirectory()`            | `GET /_matrix/federation/v1/query/directory`                        | 无           |
| `getHierarchy()`              | `GET /_matrix/federation/v1/hierarchy/{roomId}`                     | 无           |
| `getFederationInfo()`         | `GET /_matrix/federation/v1`                                        | 无           |
| `queryDestination()`          | `GET /_matrix/federation/v1/query/destination`                      | 无           |
| `getRoomEvent()`              | `GET /_matrix/federation/v1/room/{roomId}/{eventId}`                | 无           |
| `downloadMedia()`             | `GET /_matrix/federation/v1/media/download/{serverName}/{mediaId}`  | 无           |
| `getMediaThumbnail()`         | `GET /_matrix/federation/v1/media/thumbnail/{serverName}/{mediaId}` | 无           |
| `sendFederationEvent()`       | `PUT /_matrix/federation/v1/send/{txnId}`                           | 联邦签名     |
