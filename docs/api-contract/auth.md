# Auth / Account / Discovery 契约

> 审查范围覆盖 `assembly.rs` 中的 auth、account、directory 兼容路由，以及顶层版本/发现端点。

## 路由挂载概览

| 范围 | 真实挂载 |
|------|----------|
| 认证兼容路由 | `/_matrix/client/r0/*`、`/_matrix/client/v3/*` |
| 二维码登录 | `/_matrix/client/v1/login/*` |
| 账户兼容路由 | `/_matrix/client/v1/*`、`/_matrix/client/r0/*`、`/_matrix/client/v3/*` |
| 目录兼容路由 | `/_matrix/client/r0/*`、`/_matrix/client/v3/*` |
| 顶层公开端点 | `/_matrix/client/versions`、`/.well-known/*`、`/_matrix/server_version` |

## 认证要求

- 公开: `register`、`login`、`refresh`、`versions`、`well-known`、`publicRooms`、用户名可用性检查
- 用户认证: `logout`、`logout/all`、`whoami`、3PID、profile 更新、目录写操作
- 条件公开: `publicRooms` 读取与查询由处理器自行判定，可匿名访问

## 认证端点

| 方法 | 路径 | 版本 | 主要请求参数 | 主要响应字段 | 常见状态码 |
|------|------|------|--------------|--------------|------------|
| GET | `/_matrix/client/r0/register` | r0 | 无 | 注册 flow 列表 | `200` |
| POST | `/_matrix/client/r0/register` | r0 | `username` `password` `auth` `device_id` | `access_token` `user_id` `device_id` `refresh_token?` | `200` `400` `401` `409` `429` |
| GET | `/_matrix/client/v3/register` | v3 | 无 | 注册 flow 列表 | `200` |
| POST | `/_matrix/client/v3/register` | v3 | 同上 | 同上 | `200` `400` `401` `409` `429` |
| GET | `/_matrix/client/r0/register/available` | r0 | `username` | `available` | `200` `400` |
| GET | `/_matrix/client/v3/register/available` | v3 | `username` | `available` | `200` `400` |
| POST | `/_matrix/client/r0/register/email/requestToken` | r0 | 邮箱验证参数 | token/会话信息 | `200` `400` |
| POST | `/_matrix/client/v3/register/email/requestToken` | v3 | 邮箱验证参数 | token/会话信息 | `200` `400` |
| POST | `/_matrix/client/r0/register/email/submitToken` | r0 | token 提交参数 | 验证结果 | `200` `400` |
| POST | `/_matrix/client/v3/register/email/submitToken` | v3 | token 提交参数 | 验证结果 | `200` `400` |
| GET | `/_matrix/client/r0/login` | r0 | 无 | 登录 flow 列表 | `200` |
| POST | `/_matrix/client/r0/login` | r0 | `type` `identifier` `password/token` `device_id` | `access_token` `user_id` `device_id` `refresh_token?` | `200` `400` `401` `403` `429` |
| GET | `/_matrix/client/v3/login` | v3 | 无 | 登录 flow 列表 | `200` |
| POST | `/_matrix/client/v3/login` | v3 | 同上 | 同上 | `200` `400` `401` `403` `429` |
| POST | `/_matrix/client/r0/logout` | r0 | 无 | 空对象 | `200` `401` |
| POST | `/_matrix/client/v3/logout` | v3 | 无 | 空对象 | `200` `401` |
| POST | `/_matrix/client/r0/logout/all` | r0 | 无 | 空对象 | `200` `401` |
| POST | `/_matrix/client/v3/logout/all` | v3 | 无 | 空对象 | `200` `401` |
| POST | `/_matrix/client/r0/refresh` | r0 | `refresh_token` | `access_token` `refresh_token?` `expires_in_ms?` | `200` `400` `401` |
| POST | `/_matrix/client/v3/refresh` | v3 | `refresh_token` | 同上 | `200` `400` `401` |
| POST | `/_matrix/client/v3/login/saml/redirect` | v3 | `redirect_url?` | `redirect_url` `saml_request_id` | `200` `400` |
| POST | `/_matrix/client/v3/login/saml/callback` | v3 | `SAMLResponse` `RelayState?` | `access_token` `user_id` `device_id` `refresh_token?` | `200` `400` `401` |
| GET | `/_matrix/client/v3/login/saml/metadata` | v3 | 无 | `metadata` | `200` |
| GET | `/_matrix/client/v1/auth_metadata` | v1 | 无 | OIDC metadata 与可选签名密钥 | `200` `404` |
| GET | `/_matrix/client/unstable/org.matrix.msc2965/auth_issuer` | unstable | 无 | `issuer` | `200` `404` |

## 二维码登录端点

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | `/_matrix/client/v1/login/get_qr_code` | 公开 | 获取二维码内容 |
| POST | `/_matrix/client/v1/login/qr/start` | 公开 | 启动二维码登录事务 |
| POST | `/_matrix/client/v1/login/qr/confirm` | 用户态或事务态 | 确认二维码登录 |
| GET | `/_matrix/client/v1/login/qr/{transaction_id}/status` | 公开 | 查询二维码登录状态 |
| POST | `/_matrix/client/v1/login/qr/invalidate` | 公开 | 使二维码登录事务失效 |

## 账户端点

| 方法 | 路径 | 版本 | 主要请求参数 | 主要响应字段 | 认证 |
|------|------|------|--------------|--------------|------|
| GET | `/_matrix/client/v1/account/whoami` | v1 | 无 | `user_id` `device_id?` `is_guest?` | 用户 |
| GET | `/_matrix/client/r0/account/whoami` | r0 | 无 | 同上 | 用户 |
| GET | `/_matrix/client/v3/account/whoami` | v3 | 无 | 同上 | 用户 |
| POST | `/_matrix/client/v1/account/password` | v1 | 密码修改 UIA 请求 | 空对象 / UIA 流程 | 用户 |
| POST | `/_matrix/client/r0/account/password` | r0 | 同上 | 同上 | 用户 |
| POST | `/_matrix/client/v3/account/password` | v3 | 同上 | 同上 | 用户 |
| POST | `/_matrix/client/v1/account/deactivate` | v1 | 注销请求体 | 空对象 | 用户 |
| POST | `/_matrix/client/r0/account/deactivate` | r0 | 同上 | 空对象 | 用户 |
| POST | `/_matrix/client/v3/account/deactivate` | v3 | 同上 | 空对象 | 用户 |
| GET/POST | `/_matrix/client/{v1,r0,v3}/account/3pid` | v1/r0/v3 | 3PID 查询/新增 | 3PID 列表 / 空对象 | 用户 |
| POST | `/_matrix/client/{v1,r0,v3}/account/3pid/add` | v1/r0/v3 | 3PID 参数 | 空对象 | 用户 |
| POST | `/_matrix/client/{v1,r0,v3}/account/3pid/bind` | v1/r0/v3 | 3PID 参数 | 空对象 | 用户 |
| POST | `/_matrix/client/{v1,r0,v3}/account/3pid/delete` | v1/r0/v3 | 删除参数 | 空对象 | 用户 |
| POST | `/_matrix/client/{v1,r0,v3}/account/3pid/unbind` | v1/r0/v3 | 解绑参数 | 空对象 | 用户 |
| GET | `/_matrix/client/{v1,r0,v3}/profile/{user_id}` | v1/r0/v3 | `user_id` | `displayname` `avatar_url` 等 | 读公开资料 |
| GET/PUT | `/_matrix/client/{v1,r0,v3}/profile/{user_id}/displayname` | v1/r0/v3 | `displayname` | 读取或空对象 | 读公开 / 写用户 |
| GET/PUT | `/_matrix/client/{v1,r0,v3}/profile/{user_id}/avatar_url` | v1/r0/v3 | `avatar_url` | 读取或空对象 | 读公开 / 写用户 |
| GET/PUT/DELETE | `/_matrix/client/{v1,r0,v3}/profile/{user_id}/{key}` | v1/r0/v3 | `key` | 扩展属性值 | 读公开 / 写用户 / 删除用户 |
| GET | `/_matrix/client/r0/account/profile/{user_id}` | r0 专用 | `user_id` | profile | 用户 |
| PUT | `/_matrix/client/r0/account/profile/{user_id}/displayname` | r0 专用 | `displayname` | 空对象 | 用户 |
| PUT | `/_matrix/client/r0/account/profile/{user_id}/avatar_url` | r0 专用 | `avatar_url` | 空对象 | 用户 |

## 目录与公开房间端点

| 方法 | 路径 | 版本 | 说明 | 认证 |
|------|------|------|------|------|
| POST | `/_matrix/client/r0/user_directory/search` | r0 | 搜索用户目录 | 用户 |
| POST | `/_matrix/client/v3/user_directory/search` | v3 | 搜索用户目录 | 用户 |
| POST | `/_matrix/client/r0/user_directory/list` | r0 | 列举用户目录 | 用户 |
| POST | `/_matrix/client/v3/user_directory/list` | v3 | 列举用户目录 | 用户 |
| GET | `/_matrix/client/r0/user_directory/profiles/{user_id}` | r0 | 获取目录资料 | 用户 |
| GET | `/_matrix/client/v3/user_directory/profiles/{user_id}` | v3 | 获取目录资料 | 用户 |
| GET/PUT | `/_matrix/client/r0/directory/list/room/{room_id}` | r0 | 读取/设置房间可见性 | 用户 |
| GET/PUT | `/_matrix/client/v3/directory/list/room/{room_id}` | v3 | 读取/设置房间可见性 | 用户 |
| GET/PUT/DELETE | `/_matrix/client/r0/directory/room/{room_alias}` | r0 | 解析/设置/删除别名 | 用户 |
| GET/PUT/DELETE | `/_matrix/client/v3/directory/room/{room_alias}` | v3 | 解析/设置/删除别名 | 用户 |
| GET | `/_matrix/client/r0/directory/room/{room_id}/alias` | r0 专用 | 获取房间别名列表 | 用户 |
| PUT/DELETE | `/_matrix/client/r0/directory/room/{room_id}/alias/{room_alias}` | r0 专用 | 维护房间别名 | 用户 |
| GET/POST | `/_matrix/client/r0/publicRooms` | r0 | 获取/查询公开房间 | 公开 |
| GET/POST | `/_matrix/client/v3/publicRooms` | v3 | 获取/查询公开房间 | 公开 |
| GET | `/_matrix/client/v3/appservice/user` | v3 | 依据 `user_id` 检查应用服务用户是否存在 | 用户 |
| GET | `/_matrix/client/v3/appservice/alias` | v3 | 依据 `alias` 检查应用服务别名是否存在 | 用户 |
| GET | `/_matrix/client/{r0,v3}/thirdparty/protocols` | r0/v3 | 查询第三方协议列表 | 用户/按实现判定 |
| GET | `/_matrix/client/{r0,v3}/thirdparty/protocol/{protocol}` | r0/v3 | 查询第三方协议元信息 | 用户/按实现判定 |
| GET | `/_matrix/client/{r0,v3}/thirdparty/location/{protocol}` | r0/v3 | 查询第三方地点映射 | 用户/按实现判定 |
| GET | `/_matrix/client/{r0,v3}/thirdparty/user/{protocol}` | r0/v3 | 查询第三方用户映射 | 用户/按实现判定 |

## Keys 端点

| 方法 | 路径 | 版本 | 主要请求参数 | 主要响应字段 | 认证 |
|------|------|------|--------------|--------------|------|
| POST | `/_matrix/client/{r0,v3}/keys/upload` | r0/v3 | `device_keys?` `one_time_keys?` `fallback_keys?` | `one_time_key_counts` | 用户 |
| POST | `/_matrix/client/{r0,v3}/keys/query` | r0/v3 | `device_keys` `timeout?` `token?` | `device_keys` `master_keys` `self_signing_keys` `failures` | 用户 |
| POST | `/_matrix/client/{r0,v3}/keys/claim` | r0/v3 | `one_time_keys` `timeout?` | `one_time_keys` `failures` | 用户 |
| GET | `/_matrix/client/{r0,v3}/keys/changes` | r0/v3 | `from` `to` | `changed` `left` | 用户 |
| POST | `/_matrix/client/{r0,v3}/keys/signatures/upload` | r0/v3 | 签名数据 | `failures` | 用户 |

## Key Backup 扩展端点

| 方法 | 路径 | 版本 | 说明 | 认证 |
|------|------|------|------|------|
| POST | `/_matrix/client/v3/keys/backup/secure` | v3 | 创建安全密钥备份 | 用户 |
| GET | `/_matrix/client/v3/keys/backup/secure/{backup_id}` | v3 | 查询安全密钥备份 | 用户 |
| POST | `/_matrix/client/v3/keys/backup/secure/{backup_id}/verify` | v3 | 校验备份口令 | 用户 |
| POST | `/_matrix/client/v3/keys/backup/secure/{backup_id}/keys` | v3 | 写入备份密钥 | 用户 |
| POST | `/_matrix/client/v3/keys/backup/secure/{backup_id}/restore` | v3 | 恢复备份密钥 | 用户 |

## VoIP 端点

| 方法 | 路径 | 版本 | 主要请求参数 | 主要响应字段 | 认证 |
|------|------|------|--------------|--------------|------|
| GET | `/_matrix/client/{r0,v3}/voip/turnServer` | r0/v3 | 无 | `username` `password` `uris` `ttl` | 用户 |

## Search 端点

| 方法 | 路径 | 版本 | 主要请求参数 | 主要响应字段 | 认证 |
|------|------|------|--------------|--------------|------|
| POST | `/_matrix/client/{r0,v3}/search` | r0/v3 | `search_categories` `next_batch?` | `search_categories` `next_batch?` | 用户 |

## To-Device 端点

| 方法 | 路径 | 版本 | 主要请求参数 | 主要响应字段 | 认证 |
|------|------|------|--------------|--------------|------|
| PUT | `/_matrix/client/{r0,v3}/sendToDevice/{event_type}/{txn_id}` | r0/v3 | `messages` | 空对象 | 用户 |

## User Reporting 端点

| 方法 | 路径 | 版本 | 主要请求参数 | 主要响应字段 | 认证 |
|------|------|------|--------------|--------------|------|
| POST | `/_matrix/client/{r0,v3}/users/{user_id}/report` | r0/v3 | `reason` | 空对象 | 用户 |

## Login Token 端点

| 方法 | 路径 | 版本 | 主要请求参数 | 主要响应字段 | 认证 |
|------|------|------|--------------|--------------|------|
| POST | `/_matrix/client/v1/login/get_token` | v1 | `auth?` | `login_token` `expires_in` | 用户 |

## 顶层公开发现端点

| 方法 | 路径 | 主要响应 |
|------|------|----------|
| GET | `/health` | 服务健康状态 |
| GET | `/_matrix/client/versions` | 客户端版本列表 |
| GET | `/_matrix/client/v3/versions` | 客户端版本列表 |
| GET | `/_matrix/client/r0/version` | 服务器版本 |
| GET | `/_matrix/server_version` | 服务器版本 |
| GET | `/_matrix/client/v1/config/client` | 当前返回空对象 |
| GET | `/_matrix/client/r0/capabilities` | 能力声明 |
| GET | `/_matrix/client/v3/capabilities` | 能力声明 |
| GET | `/.well-known/matrix/server` | `m.server` |
| GET | `/.well-known/matrix/client` | homeserver / identity 配置 |
| GET | `/.well-known/matrix/support` | 支持联系方式 |

## 统一响应约定

- 登录/注册/刷新: 返回 token、user/device 信息
- `logout`、profile 写操作、3PID 写操作: 返回空对象
- 目录查询: 返回列表或对象，字段由处理器构造的 `Json<Value>` 决定
- 公开发现端点: 返回 JSON 对象，无用户态鉴权

## 代码定位

- 认证兼容路由: `synapse-rust/src/web/routes/assembly.rs`
- 账户兼容路由: `synapse-rust/src/web/routes/assembly.rs`
- 目录兼容路由: `synapse-rust/src/web/routes/assembly.rs`
- 处理器入口: `synapse-rust/src/web/routes/auth_compat.rs`、`account_compat.rs`、`directory_reporting.rs`

## SDK Manager 对应关系

> 更新日期: 2026-04-03

### 认证端点 SDK 封装

| 端点 | SDK Manager | 方法 |
|------|-------------|------|
| `GET /register` | `AuthManager` | `getRegisterFlows()` |
| `POST /register` | `MatrixClient` | `register()` |
| `GET /register/available` | `MatrixClient` | `isUsernameAvailable()` |
| `POST /register/email/requestToken` | `MatrixClient` | `requestRegisterEmailToken()` |
| `POST /register/email/submitToken` | `AccountManager` | `submitEmailToken()` |
| `GET /login` | `AuthManager` | `getSupportedLoginFlows()` |
| `POST /login` | `AccountManager` | `login()` |
| `POST /logout` | `AccountManager` | `logout()` |
| `POST /logout/all` | `AccountManager` | `logoutAll()` |
| `POST /refresh` | `MatrixClient` | `refreshAccessToken()` |

### 二维码登录端点 SDK 封装

| 端点 | SDK Manager | 方法 |
|------|-------------|------|
| `GET /login/get_qr_code` | `QrLoginManager` | `getQrCode()` |
| `POST /login/qr/start` | `QrLoginManager` | `startQrLogin()` |
| `POST /login/qr/confirm` | `QrLoginManager` | `confirmQrLogin()` |
| `GET /login/qr/{transaction_id}/status` | `QrLoginManager` | `getQrStatus()` |
| `POST /login/qr/invalidate` | `QrLoginManager` | `invalidateQrLogin()` |

### 账户端点 SDK 封装

| 端点 | SDK Manager | 方法 |
|------|-------------|------|
| `GET /account/whoami` | `MatrixClient` | `whoami()` |
| `POST /account/password` | `MatrixClient` | `setPassword()` |
| `POST /account/deactivate` | `AccountManager` | `deactivate()` |
| `GET /account/3pid` | `MatrixClient` | `getThreePids()` |
| `POST /account/3pid/add` | `MatrixClient` | `addThreePid()` |
| `POST /account/3pid/bind` | `MatrixClient` | `bindThreePid()` |
| `POST /account/3pid/delete` | `MatrixClient` | `deleteThreePid()` |
| `POST /account/3pid/unbind` | `MatrixClient` | `unbindThreePid()` |
| `POST /login/get_token` | `AccountManager` | `getLoginToken()` |

### Profile 端点 SDK 封装

| 端点 | SDK Manager | 方法 |
|------|-------------|------|
| `GET /profile/{user_id}` | `MatrixClient` | `getProfileInfo()` |
| `GET/PUT /profile/{user_id}/displayname` | `MatrixClient` | `getDisplayName()` / `setDisplayName()` |
| `GET/PUT /profile/{user_id}/avatar_url` | `MatrixClient` | `getAvatarUrl()` / `setAvatarUrl()` |
| `GET/PUT /profile/{user_id}/{key}` | `ProfileManager` | `getProfileAttribute()` / `setProfileAttribute()` |

### 目录与公开房间端点 SDK 封装

| 端点 | SDK Manager | 方法 |
|------|-------------|------|
| `POST /user_directory/search` | `DiscoveryManager` | `searchUserDirectory()` |
| `POST /user_directory/list` | `DiscoveryManager` | `listUserDirectory()` |
| `GET /user_directory/profiles/{user_id}` | `DiscoveryManager` | `getUserDirectoryProfile()` |
| `GET/PUT /directory/list/room/{room_id}` | `DiscoveryManager` | `getRoomVisibility()` / `setRoomVisibility()` |
| `GET/PUT/DELETE /directory/room/{room_alias}` | `DiscoveryManager` | `getRoomIdForAlias()` / `setRoomAlias()` / `deleteRoomAlias()` |
| `GET/POST /publicRooms` | `DiscoveryManager` | `getPublicRooms()` / `queryPublicRooms()` |

### 其他端点 SDK 封装

| 端点 | SDK Manager | 方法 |
|------|-------------|------|
| `GET /voip/turnServer` | `TurnServerManager` | `getTurnServer()` |
| `POST /search` | `MatrixClient` | `search()` |
| `PUT /sendToDevice/{event_type}/{txn_id}` | `MatrixClient` | `sendToDevice()` |
| `POST /users/{user_id}/report` | `UserReportManager` | `reportUser()` |

### Manager 初始化

```typescript
import { createClient, extendMatrixClientWithManagers } from "matrix-js-sdk";

// 初始化所有 Manager
await extendMatrixClientWithManagers();

const client = createClient({ baseUrl: "https://matrix.org" });

// 获取 Manager 实例
const authManager = client.getAuthManager();
const accountManager = client.getAccountManager();
const qrLoginManager = client.getQrLoginManager();
const discoveryManager = client.getDiscoveryManager();
const userReportManager = client.getUserReportManager();
```
