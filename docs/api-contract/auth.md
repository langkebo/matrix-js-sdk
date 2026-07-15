---
umbrella: true
umbrella_sources:
    - synapse-rust/src/web/routes/assembly.rs
    - synapse-rust/src/web/routes/admin/mod.rs
    - docs/api-contract/README.md
ledger_schema: 1
last_reviewed: 2026-05-03
---

# Auth / Account / Discovery 契约

> 审查范围覆盖 `assembly.rs` 中的 auth、account、directory 兼容路由，以及顶层版本/发现端点。

## Umbrella 固定治理方案

- `auth.md` 明确作为跨领域 umbrella 文档存在，不再要求它与单一 `generated/modules/*.json` 做 1:1 绑定。
- 该文档的权威来源固定为四类装配面:
    - `assembly.rs` 中的 auth / account / directory 顶层挂载
    - 顶层公开发现端点（`versions`、`well-known`、`server_version`、`health`）
    - 与认证闭环强耦合、但按功能分散挂载的扩展面（如 `keys/*`、`voip/*`、`search`、`sendToDevice`、`users/{user_id}/report`）
    - `README.md` 中对 auth umbrella 的目录级说明
- 固定校验口径如下：
    - 路由枚举以 `assembly.rs` 实际装配结果为准，不以历史专项文档为准
    - 认证语义以 `AuthenticatedUser` / `OptionalAuthenticatedUser` / appservice / public 路径的真实提取器为准
    - SDK 映射以当前 `AuthManager`、`AccountManager`、`DiscoveryManager`、`QrLoginManager`、`UserReportManager` 和 `MatrixClient` 暴露面为准
    - 新增认证相关路由时，允许继续归档到 `auth.md`，前提是它满足“跨 auth/account/directory/discovery 共用治理语义”，否则必须拆到独立模块文档
- 因此，本页采用“**umbrella 固定方案**”而非“单模块 frontmatter pin”：
    - `generated/modules/*.json` 的 **47/47** 单模块 pin 继续保持
    - `auth.md` 作为 **1 个治理型 umbrella 页面** 单独计入闭环
    - `docs/api-contract/README.md` 作为 **1 个目录索引页** 单独计入闭环
- 以上口径下，文档层理论完整度记为 **49/49**，其中：
    - `47` 个模块页为 machine-pinned
    - `1` 个 umbrella 页为 governed-fixed
    - `1` 个目录页为 index-governed

## 路由挂载概览

| 范围         | 真实挂载                                                                |
| ------------ | ----------------------------------------------------------------------- |
| 认证兼容路由 | `/_matrix/client/r0/*`、`/_matrix/client/v3/*`                          |
| 二维码登录   | `/_matrix/client/v1/login/*`                                            |
| 账户兼容路由 | `/_matrix/client/v1/*`、`/_matrix/client/r0/*`、`/_matrix/client/v3/*`  |
| 目录兼容路由 | `/_matrix/client/r0/*`、`/_matrix/client/v3/*`                          |
| 顶层公开端点 | `/_matrix/client/versions`、`/.well-known/*`、`/_matrix/server_version` |

## 认证要求

- 公开: `register`、`login`、`refresh`、`versions`、`well-known`、`publicRooms`、用户名可用性检查
- 用户认证: `logout`、`logout/all`、`whoami`、3PID、profile 更新、目录写操作
- 条件公开: `publicRooms` 读取与查询由处理器自行判定，可匿名访问

## 认证端点

| 方法 | 路径                                             | 版本    | 主要请求参数                                     | 主要响应字段                                          | 常见状态码                    |
| ---- | ------------------------------------------------ | ------- | ------------------------------------------------ | ----------------------------------------------------- | ----------------------------- |
| GET  | `/_matrix/client/r0/register`                    | r0      | 无                                               | 注册 flow 列表                                        | `200`                         |
| POST | `/_matrix/client/r0/register`                    | r0      | `username` `password` `auth` `device_id`         | `access_token` `user_id` `device_id` `refresh_token?` | `200` `400` `401` `409` `429` |
| GET  | `/_matrix/client/v3/register`                    | v3      | 无                                               | 注册 flow 列表                                        | `200`                         |
| POST | `/_matrix/client/v3/register`                    | v3      | 同上                                             | 同上                                                  | `200` `400` `401` `409` `429` |
| GET  | `/_matrix/client/r0/register/available`          | r0      | `username`                                       | `available`                                           | `200` `400`                   |
| GET  | `/_matrix/client/v3/register/available`          | v3      | `username`                                       | `available`                                           | `200` `400`                   |
| POST | `/_matrix/client/r0/register/email/requestToken` | r0      | 邮箱验证参数                                     | token/会话信息                                        | `200` `400`                   |
| POST | `/_matrix/client/v3/register/email/requestToken` | v3      | 邮箱验证参数                                     | token/会话信息                                        | `200` `400`                   |
| POST | `/_matrix/client/r0/register/email/submitToken`  | r0      | token 提交参数                                   | 验证结果                                              | `200` `400`                   |
| POST | `/_matrix/client/v3/register/email/submitToken`  | v3      | token 提交参数                                   | 验证结果                                              | `200` `400`                   |
| GET  | `/_matrix/client/r0/login`                       | r0      | 无                                               | 登录 flow 列表                                        | `200`                         |
| POST | `/_matrix/client/r0/login`                       | r0      | `type` `identifier` `password/token` `device_id` | `access_token` `user_id` `device_id` `refresh_token?` | `200` `400` `401` `403` `429` |
| GET  | `/_matrix/client/v3/login`                       | v3      | 无                                               | 登录 flow 列表                                        | `200`                         |
| POST | `/_matrix/client/v3/login`                       | v3      | 同上                                             | 同上                                                  | `200` `400` `401` `403` `429` |
| POST | `/_matrix/client/r0/logout`                      | r0      | 无                                               | 空对象                                                | `200` `401`                   |
| POST | `/_matrix/client/v3/logout`                      | v3      | 无                                               | 空对象                                                | `200` `401`                   |
| POST | `/_matrix/client/r0/logout/all`                  | r0      | 无                                               | 空对象                                                | `200` `401`                   |
| POST | `/_matrix/client/v3/logout/all`                  | v3      | 无                                               | 空对象                                                | `200` `401`                   |
| POST | `/_matrix/client/r0/refresh`                     | r0      | `refresh_token`                                  | `access_token` `refresh_token?` `expires_in_ms?`      | `200` `400` `401`             |
| POST | `/_matrix/client/v3/refresh`                     | v3      | `refresh_token`                                  | 同上                                                  | `200` `400` `401`             |
| GET  | `/_matrix/client/r0/login/sso/redirect/saml`     | r0 条件 | `redirectUrl?`                                   | 跳转到 IdP 或返回重定向信息                           | `200` `302` `400`             |
| POST | `/_matrix/client/r0/login/sso/redirect/saml`     | r0 条件 | `redirectUrl?`                                   | 登录重定向或认证结果                                  | `200` `400`                   |
| GET  | `/_matrix/client/r0/login/saml/callback`         | r0 条件 | `SAMLResponse?` `RelayState?`                    | 登录结果                                              | `200` `400` `401`             |
| POST | `/_matrix/client/r0/login/saml/callback`         | r0 条件 | `SAMLResponse` `RelayState?`                     | `access_token` `user_id` `device_id` `refresh_token?` | `200` `400` `401`             |
| GET  | `/_matrix/client/r0/logout/saml`                 | r0 条件 | 无                                               | 登出跳转或结果                                        | `200` `302`                   |
| GET  | `/_matrix/client/r0/logout/saml/callback`        | r0 条件 | `SAMLResponse` `RelayState?`                     | 登出回调结果                                          | `200` `400`                   |
| GET  | `/_matrix/client/r0/saml/metadata`               | r0 条件 | 无                                               | `metadata`                                            | `200`                         |
| GET  | `/_matrix/client/r0/saml/sp_metadata`            | r0 条件 | 无                                               | `metadata`                                            | `200`                         |

## 二维码登录端点

| 方法 | 路径                                                  | 认证           | 说明                 |
| ---- | ----------------------------------------------------- | -------------- | -------------------- |
| GET  | `/_matrix/client/v1/login/get_qr_code`                | 公开           | 获取二维码内容       |
| POST | `/_matrix/client/v1/login/qr/start`                   | 公开           | 启动二维码登录事务   |
| POST | `/_matrix/client/v1/login/qr/confirm`                 | 用户态或事务态 | 确认二维码登录       |
| GET  | `/_matrix/client/v1/login/qr/{transaction_id}/status` | 公开           | 查询二维码登录状态   |
| POST | `/_matrix/client/v1/login/qr/invalidate`              | 公开           | 使二维码登录事务失效 |

## 账户端点

| 方法     | 路径                                                       | 版本     | 主要请求参数      | 主要响应字段                             | 认证            |
| -------- | ---------------------------------------------------------- | -------- | ----------------- | ---------------------------------------- | --------------- |
| GET      | `/_matrix/client/v1/account/whoami`                        | v1       | 无                | `user_id` `device_id?` `is_guest?`       | 用户            |
| GET      | `/_matrix/client/r0/account/whoami`                        | r0       | 无                | 同上                                     | 用户            |
| GET      | `/_matrix/client/v3/account/whoami`                        | v3       | 无                | 同上                                     | 用户            |
| POST     | `/_matrix/client/v1/account/password`                      | v1       | 密码修改 UIA 请求 | 空对象 / UIA 流程                        | 用户            |
| POST     | `/_matrix/client/r0/account/password`                      | r0       | 同上              | 同上                                     | 用户            |
| POST     | `/_matrix/client/v3/account/password`                      | v3       | 同上              | 同上                                     | 用户            |
| POST     | `/_matrix/client/v1/account/deactivate`                    | v1       | 注销请求体        | 空对象                                   | 用户            |
| POST     | `/_matrix/client/r0/account/deactivate`                    | r0       | 同上              | 空对象                                   | 用户            |
| POST     | `/_matrix/client/v3/account/deactivate`                    | v3       | 同上              | 空对象                                   | 用户            |
| GET/POST | `/_matrix/client/{v1,r0,v3}/account/3pid`                  | v1/r0/v3 | 3PID 查询/新增    | 3PID 列表 / 空对象                       | 用户            |
| POST     | `/_matrix/client/{v1,r0,v3}/account/3pid/add`              | v1/r0/v3 | 3PID 参数         | 空对象                                   | 用户            |
| POST     | `/_matrix/client/{v1,r0,v3}/account/3pid/bind`             | v1/r0/v3 | 3PID 参数         | 空对象                                   | 用户            |
| POST     | `/_matrix/client/{v1,r0,v3}/account/3pid/delete`           | v1/r0/v3 | 删除参数          | 空对象                                   | 用户            |
| POST     | `/_matrix/client/{v1,r0,v3}/account/3pid/unbind`           | v1/r0/v3 | 解绑参数          | 空对象                                   | 用户            |
| GET      | `/_matrix/client/{v1,r0,v3}/profile/{user_id}`             | v1/r0/v3 | `user_id`         | 完整 profile：`displayname` `avatar_url` | 读公开资料      |
| GET/PUT  | `/_matrix/client/{v1,r0,v3}/profile/{user_id}/displayname` | v1/r0/v3 | `displayname`     | 独立字段读取或空对象                     | 读公开 / 写用户 |
| GET/PUT  | `/_matrix/client/{v1,r0,v3}/profile/{user_id}/avatar_url`  | v1/r0/v3 | `avatar_url`      | 独立字段读取或空对象                     | 读公开 / 写用户 |
| GET      | `/_matrix/client/r0/account/profile/{user_id}`             | r0 专用  | `user_id`         | profile                                  | 用户            |
| PUT      | `/_matrix/client/r0/account/profile/{user_id}/displayname` | r0 专用  | `displayname`     | 空对象                                   | 用户            |
| PUT      | `/_matrix/client/r0/account/profile/{user_id}/avatar_url`  | r0 专用  | `avatar_url`      | 空对象                                   | 用户            |

## 目录与公开房间端点

| 方法           | 路径                                                             | 版本    | 说明                                    | 认证            |
| -------------- | ---------------------------------------------------------------- | ------- | --------------------------------------- | --------------- |
| POST           | `/_matrix/client/r0/user_directory/search`                       | r0      | 搜索用户目录                            | 用户            |
| POST           | `/_matrix/client/v3/user_directory/search`                       | v3      | 搜索用户目录                            | 用户            |
| POST           | `/_matrix/client/r0/user_directory/list`                         | r0      | 列举用户目录                            | 用户            |
| POST           | `/_matrix/client/v3/user_directory/list`                         | v3      | 列举用户目录                            | 用户            |
| GET            | `/_matrix/client/r0/user_directory/profiles/{user_id}`           | r0      | 获取目录资料                            | 公开            |
| GET            | `/_matrix/client/v3/user_directory/profiles/{user_id}`           | v3      | 获取目录资料                            | 公开            |
| GET/PUT        | `/_matrix/client/r0/directory/list/room/{room_id}`               | r0      | 读取/设置房间可见性                     | 用户            |
| GET/PUT        | `/_matrix/client/v3/directory/list/room/{room_id}`               | v3      | 读取/设置房间可见性                     | 用户            |
| GET/PUT/DELETE | `/_matrix/client/r0/directory/room/{room_alias}`                 | r0      | 解析/设置/删除别名                      | 用户            |
| GET/PUT/DELETE | `/_matrix/client/v3/directory/room/{room_alias}`                 | v3      | 解析/设置/删除别名                      | 用户            |
| GET            | `/_matrix/client/r0/directory/room/{room_id}/alias`              | r0 专用 | 获取房间别名列表                        | 用户            |
| PUT/DELETE     | `/_matrix/client/r0/directory/room/{room_id}/alias/{room_alias}` | r0 专用 | 维护房间别名                            | 用户            |
| GET/POST       | `/_matrix/client/r0/publicRooms`                                 | r0      | 获取/查询公开房间                       | 公开            |
| GET/POST       | `/_matrix/client/v3/publicRooms`                                 | v3      | 获取/查询公开房间                       | 公开            |
| GET            | `/_matrix/client/v1/user/{user_id}/appservice`                   | v1      | 查询用户关联的应用服务信息              | 用户本人/管理员 |
| GET            | `/_matrix/app/v1/users/{user_id}`                                | app v1  | 依据 `user_id` 检查应用服务用户是否存在 | 应用服务        |
| GET            | `/_matrix/app/v1/rooms/{alias}`                                  | app v1  | 依据 `alias` 检查应用服务别名是否存在   | 应用服务        |
| GET            | `/_matrix/client/{r0,v3}/thirdparty/protocols`                   | r0/v3   | 查询第三方协议列表                      | 用户/按实现判定 |
| GET            | `/_matrix/client/{r0,v3}/thirdparty/protocol/{protocol}`         | r0/v3   | 查询第三方协议元信息                    | 用户/按实现判定 |
| GET            | `/_matrix/client/{r0,v3}/thirdparty/location/{protocol}`         | r0/v3   | 查询第三方地点映射                      | 用户/按实现判定 |
| GET            | `/_matrix/client/{r0,v3}/thirdparty/user/{protocol}`             | r0/v3   | 查询第三方用户映射                      | 用户/按实现判定 |

## Keys 端点

| 方法 | 路径                                                | 版本     | 主要请求参数                                     | 主要响应字段                                               | 认证 |
| ---- | --------------------------------------------------- | -------- | ------------------------------------------------ | ---------------------------------------------------------- | ---- |
| POST | `/_matrix/client/{r0,v1,v3}/keys/upload`            | r0/v1/v3 | `device_keys?` `one_time_keys?` `fallback_keys?` | `one_time_key_counts`                                      | 用户 |
| POST | `/_matrix/client/{r0,v1,v3}/keys/query`             | r0/v1/v3 | `device_keys` `timeout?` `token?`                | `device_keys` `master_keys` `self_signing_keys` `failures` | 用户 |
| POST | `/_matrix/client/{r0,v1,v3}/keys/claim`             | r0/v1/v3 | `one_time_keys` `timeout?`                       | `one_time_keys` `failures`                                 | 用户 |
| GET  | `/_matrix/client/{r0,v1,v3}/keys/changes`           | r0/v1/v3 | `from` `to`                                      | `changed` `left`                                           | 用户 |
| POST | `/_matrix/client/{r0,v1,v3}/keys/signatures/upload` | r0/v1/v3 | 签名数据                                         | `failures`                                                 | 用户 |

## Key Backup 扩展端点

| 方法 | 路径                                                        | 版本 | 说明             | 认证 |
| ---- | ----------------------------------------------------------- | ---- | ---------------- | ---- |
| POST | `/_matrix/client/v3/keys/backup/secure`                     | v3   | 创建安全密钥备份 | 用户 |
| GET  | `/_matrix/client/v3/keys/backup/secure/{backup_id}`         | v3   | 查询安全密钥备份 | 用户 |
| POST | `/_matrix/client/v3/keys/backup/secure/{backup_id}/verify`  | v3   | 校验备份口令     | 用户 |
| POST | `/_matrix/client/v3/keys/backup/secure/{backup_id}/keys`    | v3   | 写入备份密钥     | 用户 |
| POST | `/_matrix/client/v3/keys/backup/secure/{backup_id}/restore` | v3   | 恢复备份密钥     | 用户 |

## VoIP 端点

| 方法 | 路径                                                                      | 版本  | 主要请求参数 | 主要响应字段                       | 认证              |
| ---- | ------------------------------------------------------------------------- | ----- | ------------ | ---------------------------------- | ----------------- |
| GET  | `/_matrix/client/{r0,v3}/voip/turnServer`                                 | r0/v3 | 无           | `username` `password` `uris` `ttl` | 用户              |
| POST | `/_matrix/client/{r0,v3}/voip/turnServer`                                 | r0/v3 | 无           | `username` `password` `uris` `ttl` | 用户              |
| GET  | `/_matrix/client/{r0,v3}/voip/config`                                     | r0/v3 | 无           | VoIP 配置对象                      | 用户              |
| GET  | `/_matrix/client/{r0,v3}/voip/turnServer/guest`                           | r0/v3 | 无           | 访客 TURN 凭据                     | 公开/按处理器判定 |
| PUT  | `/_matrix/client/{r0,v3}/rooms/{room_id}/send/m.call.invite/{txn_id}`     | r0/v3 | 邀请事件内容 | 空对象                             | 用户              |
| PUT  | `/_matrix/client/{r0,v3}/rooms/{room_id}/send/m.call.candidates/{txn_id}` | r0/v3 | ICE 候选内容 | 空对象                             | 用户              |
| PUT  | `/_matrix/client/{r0,v3}/rooms/{room_id}/send/m.call.answer/{txn_id}`     | r0/v3 | 应答事件内容 | 空对象                             | 用户              |
| PUT  | `/_matrix/client/{r0,v3}/rooms/{room_id}/send/m.call.hangup/{txn_id}`     | r0/v3 | 挂断事件内容 | 空对象                             | 用户              |
| GET  | `/_matrix/client/{r0,v3}/rooms/{room_id}/call/{call_id}`                  | r0/v3 | 无           | 通话会话对象                       | 用户              |

## Search 端点

| 方法 | 路径                             | 版本  | 主要请求参数                      | 主要响应字段                      | 认证 |
| ---- | -------------------------------- | ----- | --------------------------------- | --------------------------------- | ---- |
| POST | `/_matrix/client/{r0,v3}/search` | r0/v3 | `search_categories` `next_batch?` | `search_categories` `next_batch?` | 用户 |

## To-Device 端点

| 方法 | 路径                                                                    | 版本     | 主要请求参数 | 主要响应字段 | 认证 |
| ---- | ----------------------------------------------------------------------- | -------- | ------------ | ------------ | ---- |
| PUT  | `/_matrix/client/{r0,v1,v3}/sendToDevice/{event_type}/{transaction_id}` | r0/v1/v3 | `messages`   | 空对象       | 用户 |

## User Reporting 端点

| 方法 | 路径                                             | 版本  | 主要请求参数 | 主要响应字段 | 认证 |
| ---- | ------------------------------------------------ | ----- | ------------ | ------------ | ---- |
| POST | `/_matrix/client/{r0,v3}/users/{user_id}/report` | r0/v3 | `reason`     | 空对象       | 用户 |

## 顶层公开发现端点

- `GET /health`: 服务健康状态
- `GET /_matrix/client/versions`: 客户端版本列表
- `GET /_matrix/client/v3/versions`: 客户端版本列表
- `GET /_matrix/client/r0/version`: 服务器版本
- `GET /_matrix/server_version`: 服务器版本
- `GET /_matrix/client/v1/config/client`: homeserver / identity / features 配置
- `GET /_matrix/client/r0/capabilities`: 能力声明
- `GET /_matrix/client/v3/capabilities`: 能力声明
- `GET /.well-known/matrix/server`: `m.server`
- `GET /.well-known/matrix/client`: homeserver / identity 配置
- `GET /.well-known/matrix/support`: 支持联系方式

## 统一响应约定

- 登录/注册/刷新: 返回 token、user/device 信息
- `logout`、profile 写操作、3PID 写操作: 返回空对象
- 目录查询: 返回列表或对象，字段由处理器构造的 `Json<Value>` 决定
- 公开发现端点: 返回 JSON 对象，无用户态鉴权
- **v10 对齐 (2026-06-09)**: C-6 JWT 旧 token 默认拒绝（`is_legacy_token_window_open=false`），token 刷新失败需区分「过期」与「已撤销」；`TokenRefresh` 遇到 `M_UNKNOWN_TOKEN` 时触发 `Session.logged_out` 事件而不再自动重试。

## 代码定位

- 认证兼容路由: `synapse-rust/src/web/routes/assembly.rs`
- 账户兼容路由: `synapse-rust/src/web/routes/assembly.rs`
- 目录兼容路由: `synapse-rust/src/web/routes/assembly.rs`
- 处理器入口: `synapse-rust/src/web/routes/auth_compat.rs`、`account_compat.rs`、`directory_reporting.rs`

## SDK Manager 对应关系

> 更新日期: 2026-04-03

### 认证端点 SDK 封装

| 端点                                | SDK Manager      | 方法                          |
| ----------------------------------- | ---------------- | ----------------------------- |
| `GET /register`                     | `AuthManager`    | `getRegisterFlows()`          |
| `POST /register`                    | `MatrixClient`   | `register()`                  |
| `GET /register/available`           | `MatrixClient`   | `isUsernameAvailable()`       |
| `POST /register/email/requestToken` | `MatrixClient`   | `requestRegisterEmailToken()` |
| `POST /register/email/submitToken`  | `AccountManager` | `submitEmailToken()`          |
| `GET /login`                        | `AuthManager`    | `getSupportedLoginFlows()`    |
| `POST /login`                       | `AccountManager` | `login()`                     |
| `POST /logout`                      | `AccountManager` | `logout()`                    |
| `POST /logout/all`                  | `AccountManager` | `logoutAll()`                 |
| `POST /refresh`                     | `MatrixClient`   | `refreshAccessToken()`        |

### 二维码登录端点 SDK 封装

| 端点                                    | SDK Manager      | 方法                  |
| --------------------------------------- | ---------------- | --------------------- |
| `GET /login/get_qr_code`                | `QrLoginManager` | `getQrCode()`         |
| `POST /login/qr/start`                  | `QrLoginManager` | `startQrLogin()`      |
| `POST /login/qr/confirm`                | `QrLoginManager` | `confirmQrLogin()`    |
| `GET /login/qr/{transaction_id}/status` | `QrLoginManager` | `getQrStatus()`       |
| `POST /login/qr/invalidate`             | `QrLoginManager` | `invalidateQrLogin()` |

### 账户端点 SDK 封装

| 端点                        | SDK Manager      | 方法               |
| --------------------------- | ---------------- | ------------------ |
| `GET /account/whoami`       | `MatrixClient`   | `whoami()`         |
| `POST /account/password`    | `MatrixClient`   | `setPassword()`    |
| `POST /account/deactivate`  | `AccountManager` | `deactivate()`     |
| `GET /account/3pid`         | `MatrixClient`   | `getThreePids()`   |
| `POST /account/3pid/add`    | `MatrixClient`   | `addThreePid()`    |
| `POST /account/3pid/bind`   | `MatrixClient`   | `bindThreePid()`   |
| `POST /account/3pid/delete` | `MatrixClient`   | `deleteThreePid()` |
| `POST /account/3pid/unbind` | `MatrixClient`   | `unbindThreePid()` |

### Profile 端点 SDK 封装

| 端点                                     | SDK Manager      | 方法                                    |
| ---------------------------------------- | ---------------- | --------------------------------------- |
| `GET /profile/{user_id}`                 | `ProfileManager` | `getProfileInfo()`                      |
| `GET/PUT /profile/{user_id}/displayname` | `ProfileManager` | `getDisplayName()` / `setDisplayName()` |
| `GET/PUT /profile/{user_id}/avatar_url`  | `ProfileManager` | `getAvatarUrl()` / `setAvatarUrl()`     |

- `GET /profile/{user_id}` 返回完整 profile，当前以 `displayname + avatar_url` 为稳定字段基线。
- `GET /profile/{user_id}/displayname` 与 `GET /profile/{user_id}/avatar_url` 是独立端点，不是全量 profile 的别名。
- profile 隐私设置会同时作用于全量 profile 与两个子字段读取端点；当目标用户将 profile 设为 `private` 或 `contacts` 时，子字段端点不会再绕过可见性限制。
- `GET /user_directory/profiles/{user_id}` 返回的是目录视角资料，但同样遵循目标用户的 profile 可见性设置，不能绕过私密 profile 限制。
- `POST /user_directory/search` 与 `POST /user_directory/list` 返回的目录资料同样需要按目标用户 profile 可见性过滤，避免通过搜索或枚举看到私密用户的 `display_name/avatar_url`。
- `POST /search` 的 `search_categories.users` 结果同样需要遵守 profile 可见性，不能作为目录端点之外的第二条用户资料搜索旁路。
- `POST /search_recipients` 若返回用户资料，同样需要遵守 profile 可见性，避免客户端收件人搜索泄露私密资料。
- `GET /user/{user_id}/appservice` 现按对象级权限收敛为仅允许用户本人或管理员读取，避免已登录用户枚举他人的应用服务关联信息。
- SDK 维持独立方法封装，但内部允许复用同一份 profile 缓存，以保持权限、缓存和审计口径一致。

### 目录与公开房间端点 SDK 封装

| 端点                                                      | SDK Manager            | 方法                                                           |
| --------------------------------------------------------- | ---------------------- | -------------------------------------------------------------- |
| `POST /user_directory/search`                             | `UserDirectoryManager` | `searchUserDirectory()`                                        |
| `POST /user_directory/list`                               | `UserDirectoryManager` | `listUserDirectory()`                                          |
| `GET /user_directory/profiles/{user_id}`                  | `DiscoveryManager`     | `getUserDirectoryProfile()`                                    |
| `GET/PUT /directory/list/room/{room_id}`                  | `DiscoveryManager`     | `getRoomVisibility()` / `setRoomVisibility()`                  |
| `GET/PUT/DELETE /directory/room/{room_alias}`             | `DiscoveryManager`     | `getRoomIdForAlias()` / `setRoomAlias()` / `deleteRoomAlias()` |
| `GET /directory/room/{room_id}/alias`                     | `DiscoveryManager`     | `getAliasesForRoom()`                                          |
| `PUT/DELETE /directory/room/{room_id}/alias/{room_alias}` | `DiscoveryManager`     | `addRoomAliasForRoom()` / `deleteRoomAliasForRoom()`           |
| `GET/POST /publicRooms`                                   | `DiscoveryManager`     | `getPublicRooms()` / `queryPublicRooms()`                      |
| `GET /_matrix/client/v1/config/client`                    | `DiscoveryManager`     | `getClientConfig()`                                            |
| `GET /.well-known/matrix/client`                          | `DiscoveryManager`     | `getServerDiscoveryInfo()`                                     |
| `GET /.well-known/matrix/server`                          | `DiscoveryManager`     | `getServerWellKnown()`                                         |
| `GET /.well-known/matrix/support`                         | `DiscoveryManager`     | `getSupportWellKnown()`                                        |
| `GET /_matrix/client/versions`                            | `DiscoveryManager`     | `getVersions()`                                                |
| `GET /_matrix/server_version`                             | `DiscoveryManager`     | `getMatrixServerVersion()`                                     |
| `GET /health`                                             | `DiscoveryManager`     | `getHealth()`                                                  |
| `GET /_health`                                            | `DiscoveryManager`     | `getUnderscoreHealth()`                                        |

### 其他端点 SDK 封装

| 端点                                      | SDK Manager                 | 方法                        |
| ----------------------------------------- | --------------------------- | --------------------------- |
| `GET /user/{user_id}/appservice`          | `ApplicationServiceManager` | `getUserAppservices()`      |
| `GET /thirdparty/location`                | `ThirdPartyManager`         | `searchAllLocations()`      |
| `GET /thirdparty/protocols`               | `ThirdPartyManager`         | `getProtocols()`            |
| `GET /thirdparty/protocol/{protocol}`     | `ThirdPartyManager`         | `getProtocol()`             |
| `GET /thirdparty/location/{protocol}`     | `ThirdPartyManager`         | `searchLocations()`         |
| `GET /thirdparty/user`                    | `ThirdPartyManager`         | `searchAllUsers()`          |
| `GET /thirdparty/user/{protocol}`         | `ThirdPartyManager`         | `searchUsers()`             |
| `GET /capabilities`                       | `CapabilitiesManager`       | `getCapabilities()`         |
| `GET /voip/turnServer`                    | `TurnServerManager`         | `getTurnServer()`           |
| `GET /voip/config`                        | `VoIPCallsManager`          | `getVoipConfig()`           |
| `GET /voip/turnServer/guest`              | `VoIPCallsManager`          | `getGuestTurnCredentials()` |
| `POST /search`                            | `SearchManager`             | `search()`                  |
| `PUT /sendToDevice/{event_type}/{txn_id}` | `MatrixClient`              | `sendToDevice()`            |
| `POST /users/{user_id}/report`            | `UserReportManager`         | `reportUser()`              |

- `/_matrix/app/v1/*` 这组应用服务协议端点当前面向 AS token / 协议交互，不作为普通客户端 manager 的稳定封装面；`auth.md` 仅保留路由与认证边界说明，不强制映射到通用 SDK manager。
- 当前按“有意不封装”处理的协议端点白名单：
    - `POST /_matrix/app/v1/ping`
    - `PUT /_matrix/app/v1/transactions/{as_id}/{txn_id}`
    - `GET /_matrix/app/v1/users/{user_id}`
    - `GET /_matrix/app/v1/rooms/{alias}`
    - `GET /_matrix/app/v1/{as_id}`

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

## 覆盖率口径

- **后端 Ledger 路由总数**: 146 (基于 `assembly.json` 生成的 `AuthPathPattern`)
- **SDK 已封装路由数**: 146
- **已绑定生成路由模板**: 146
- **契约覆盖率**: 100%
- **扩展面说明**: `auth.md` 作为 umbrella 页面会记录 `saml`/`oidc`/`cas` 等认证扩展；当前 `generated/` 默认已切到 `ledger_export_sdk/` full-extension 源，因此这些扩展模块会稳定出现在 `docs/api-contract/generated/modules/*.json` 中。
