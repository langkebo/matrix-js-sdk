# Account Data 模块契约

> 审查来源: `synapse-rust/src/web/routes/account_data.rs`

## 挂载版本

| 前缀 | 路由 |
|------|------|
| `/_matrix/client/r0` | 全量 account data 与 filter 路由 |
| `/_matrix/client/v3` | 全量 account data 与 filter 路由 |

## 路由清单

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/_matrix/client/{r0,v3}/user/{user_id}/account_data/` | 列出当前用户全部 account data | 用户 |
| GET/PUT/DELETE | `/_matrix/client/{r0,v3}/user/{user_id}/account_data/{type}` | 读取/写入/删除用户级 account data | 用户 |
| GET/PUT/DELETE | `/_matrix/client/{r0,v3}/user/{user_id}/rooms/{room_id}/account_data/{type}` | 读取/写入/删除房间级 account data | 用户 |
| POST | `/_matrix/client/{r0,v3}/user/{user_id}/filter` | 创建 filter | 用户 |
| GET | `/_matrix/client/{r0,v3}/user/{user_id}/filter/{filter_id}` | 获取 filter | 用户 |
| DELETE | `/_matrix/client/{r0,v3}/user/{user_id}/filter/{filter_id}` | 删除 filter | 用户 |
| POST | `/_matrix/client/{r0,v3}/user/{user_id}/openid/request_token` | 获取 OpenID token | 用户 |

## Tags 端点

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/_matrix/client/{r0,v3}/user/{user_id}/rooms/{room_id}/tags` | 获取房间标签列表 | 用户 |
| PUT | `/_matrix/client/{r0,v3}/user/{user_id}/rooms/{room_id}/tags/{tag}` | 设置房间标签 | 用户 |
| DELETE | `/_matrix/client/{r0,v3}/user/{user_id}/rooms/{room_id}/tags/{tag}` | 删除房间标签 | 用户 |

## 代码中可见稳定响应

| 路径 | 响应要点 |
|------|----------|
| `account_data/` | `{ "account_data": { "<type>": <content>, ... } }` |
| `account_data/{type}` | 返回该类型内容；不存在时通常返回空对象，`m.push_rules` 返回默认规则骨架 |
| `rooms/{room_id}/account_data/{type}` | 返回房间级内容；不存在时 `404` |
| `filter` | 创建时返回 filter 创建结果 |
| `openid/request_token` | 返回 OpenID token 对象 |

## 请求体要点

- 写用户级 account data: 任意 JSON body
- 写房间级 account data: 任意 JSON body
- 创建 filter: 任意 JSON filter 定义

## 权限约束

- `user_id` 必须等于当前 access token 对应用户，否则返回 `403`

## 常见状态码

| 状态码 | 说明 |
|--------|------|
| `200` | 请求成功 |
| `403` | 访问了其他用户的 account data |
| `404` | 指定 room account data 或 filter 不存在 |

## 代码定位

- 路由与处理器: `synapse-rust/src/web/routes/account_data.rs`
