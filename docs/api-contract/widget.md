---
module: widget
generated_from: docs/api-contract/generated/modules/widget.json
generated_hash: sha256-3a81f51dc367bd02c0c2f46959162351fed582d953a37d4d074ebf0b418d0329
ledger_schema: 1
last_reviewed: 2026-05-03
---

# Widget 模块契约

> 版本: v1.0.0
> 更新日期: 2026-04-13
> 对应 SDK 模块: `src/widget/index.ts`
> 审查来源: `synapse-rust/src/web/routes/widget.rs`
> 审计状态: ⚠️ 已拆分独立契约，后端 `v1/v3` widget 鉴权与 session 路径语义已对齐，剩余差距主要是少量 SDK 未封装端点

## 挂载版本

| 前缀                 | 路由                                                                                                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/_matrix/client/v1` | `/widgets`、`/widgets/{widget_id}`、`/widgets/{widget_id}/config`、`/widgets/{widget_id}/permissions`、`/widgets/{widget_id}/permissions/{user_id}`、`/widgets/{widget_id}/sessions`、`/widgets/sessions/{session_id}`、`/rooms/{room_id}/widgets`、`/rooms/{room_id}/widgets/jitsi/config` |
| `/_matrix/client/v3` | `/rooms/{room_id}/widgets/{widget_id}/capabilities`、`/rooms/{room_id}/widgets/{widget_id}/send`                                                                                                                                                                                            |

## 路由清单

| 方法   | 路径                                                                  | 说明                 | 认证 |
| ------ | --------------------------------------------------------------------- | -------------------- | ---- |
| POST   | `/_matrix/client/v1/widgets`                                          | 创建小组件           | 用户 |
| GET    | `/_matrix/client/v1/widgets/{widget_id}`                              | 获取小组件详情       | 用户 |
| PUT    | `/_matrix/client/v1/widgets/{widget_id}`                              | 更新小组件           | 用户 |
| DELETE | `/_matrix/client/v1/widgets/{widget_id}`                              | 删除小组件           | 用户 |
| GET    | `/_matrix/client/v1/widgets/{widget_id}/config`                       | 获取小组件配置       | 用户 |
| GET    | `/_matrix/client/v1/rooms/{room_id}/widgets`                          | 获取房间小组件列表   | 用户 |
| GET    | `/_matrix/client/v1/rooms/{room_id}/widgets/jitsi/config`             | 获取 Jitsi 配置      | 公开 |
| GET    | `/_matrix/client/v3/rooms/{room_id}/widgets/{widget_id}/capabilities` | 获取房间小组件能力   | 用户 |
| PUT    | `/_matrix/client/v3/rooms/{room_id}/widgets/{widget_id}/capabilities` | 设置房间小组件能力   | 用户 |
| POST   | `/_matrix/client/v3/rooms/{room_id}/widgets/{widget_id}/send`         | 向房间小组件发送消息 | 用户 |
| POST   | `/_matrix/client/v1/widgets/{widget_id}/permissions`                  | 设置小组件权限       | 用户 |
| GET    | `/_matrix/client/v1/widgets/{widget_id}/permissions`                  | 获取小组件权限列表   | 用户 |
| DELETE | `/_matrix/client/v1/widgets/{widget_id}/permissions/{user_id}`        | 删除小组件权限       | 用户 |
| POST   | `/_matrix/client/v1/widgets/{widget_id}/sessions`                     | 创建小组件会话       | 用户 |
| GET    | `/_matrix/client/v1/widgets/{widget_id}/sessions`                     | 获取小组件会话列表   | 用户 |
| GET    | `/_matrix/client/v1/widgets/sessions/{session_id}`                    | 获取单个会话         | 用户 |
| DELETE | `/_matrix/client/v1/widgets/sessions/{session_id}`                    | 终止会话             | 用户 |

## 请求体与稳定响应

### `POST /_matrix/client/v1/widgets`

- 请求体稳定字段: `room_id?`、`widget_type`、`url`、`name`、`data?`
- 若传入 `room_id`，处理器会先校验房间存在性
- 成功时返回 `{ "widget": ... }`

### `GET/PUT/DELETE /_matrix/client/v1/widgets/{widget_id}`

- `GET` 与 `PUT` 成功时均返回 `{ "widget": ... }`
- `DELETE` 成功时返回 `{ "deleted": true }`
- `PUT` 请求体可选字段: `url`、`name`、`data`
- 三个端点都要求登录，并校验请求用户是否为 widget 创建者、房间成员、管理员或显式授权用户

### `GET /_matrix/client/v1/widgets/{widget_id}/config`

- 稳定字段: `widget_id`、`room_id`、`url`、`name`、`data`、`type`
- 要求登录，并沿用 widget 读取权限判断

### `GET /_matrix/client/v1/rooms/{room_id}/widgets`

- 成功时返回 `{ "total": number, "widgets": [...] }`
- 要求登录，且请求用户必须是房间成员或管理员

### `GET /_matrix/client/v1/rooms/{room_id}/widgets/jitsi/config`

- 稳定字段: `conf_id`、`name`、`domain`、`app_id`、`jwt`

### `GET/PUT /_matrix/client/v3/rooms/{room_id}/widgets/{widget_id}/capabilities`

- 两个处理器都会校验请求用户是否为房间成员或管理员
- 若 widget 不属于该房间，返回 `400`
- `GET` 稳定字段: `capabilities`、`widget_id`、`room_id`
- `PUT` 请求体为 `{ "capabilities": string[] }`

### `POST /_matrix/client/v3/rooms/{room_id}/widgets/{widget_id}/send`

- 请求体稳定字段: `type`、`content`
- 成功响应稳定字段: `event_id`、`widget_id`、`room_id`、`type`、`content`

### 权限相关端点

- `POST /permissions` 请求体要求 `user_id` 与 `permissions`
- 成功响应为 `{ "success": true, "permission_id": number }`
- `GET /permissions` 返回 `{ "permissions": [...] }`
- `DELETE /permissions/{user_id}` 返回 `{ "deleted": boolean }`
- 三个端点都要求登录，并沿用 widget 写入/读取权限判断

### 会话相关端点

- `POST /widgets/{widget_id}/sessions` 现在以路径中的 `widget_id` 为准
- `POST` 请求体稳定字段: `widget_id?`、`device_id?`、`expires_in_ms?`
- 若 body 也传了 `widget_id` 且与路径不一致，返回 `400`
- `POST` 与 `GET /widgets/sessions/{session_id}` 成功时均返回 `{ "session": ... }`
- `GET /widgets/{widget_id}/sessions` 返回 `{ "total": number, "sessions": [...] }`
- `DELETE /widgets/sessions/{session_id}` 返回 `{ "terminated": boolean }`
- 三个读取/终止端点都要求登录，并校验 session 归属或 widget 访问权限

## 常见状态码

| 状态码 | 说明                                                     |
| ------ | -------------------------------------------------------- |
| `200`  | 请求成功                                                 |
| `400`  | widget 与 room 不匹配，或请求体字段不合法                |
| `401`  | 需认证的 widget / session / 房间级接口缺少或使用无效令牌 |
| `403`  | 已登录但无 widget 访问权限，或不是房间成员且非管理员     |
| `404`  | 房间、widget 或 session 不存在                           |
| `500`  | 存储层或 service 层内部错误                              |

## SDK Manager 对应关系

| 后端端点                                                                  | SDK Manager     | 方法                       | 现状                                                       |
| ------------------------------------------------------------------------- | --------------- | -------------------------- | ---------------------------------------------------------- |
| `POST /_matrix/client/v1/widgets`                                         | `WidgetManager` | `addWidget()`              | ✅ 请求路径与主要字段一致                                  |
| `GET /_matrix/client/v1/widgets/{widget_id}`                              | `WidgetManager` | `getWidget()`              | ✅ 已封装                                                  |
| `PUT /_matrix/client/v1/widgets/{widget_id}`                              | `WidgetManager` | `updateWidget()`           | ✅ 已封装                                                  |
| `DELETE /_matrix/client/v1/widgets/{widget_id}`                           | `WidgetManager` | `removeWidget()`           | ✅ 已封装                                                  |
| `GET /_matrix/client/v1/rooms/{room_id}/widgets`                          | `WidgetManager` | `getRoomWidgets()`         | ✅ 已封装                                                  |
| `GET /_matrix/client/v1/widgets/{widget_id}/config`                       | `WidgetManager` | `getWidgetConfig()`        | ✅ 已封装                                                  |
| `GET /_matrix/client/v1/rooms/{room_id}/widgets/jitsi/config`             | `WidgetManager` | `getJitsiConfig()`         | ✅ 已封装                                                  |
| `GET /_matrix/client/v1/widgets/{widget_id}/permissions`                  | `WidgetManager` | `getWidgetPermissions()`   | ✅ 已封装                                                  |
| `POST /_matrix/client/v1/widgets/{widget_id}/permissions`                 | `WidgetManager` | `setWidgetPermission()`    | ✅ 已封装                                                  |
| `DELETE /_matrix/client/v1/widgets/{widget_id}/permissions/{user_id}`     | `WidgetManager` | `deleteWidgetPermission()` | ✅ 已封装                                                  |
| `POST /_matrix/client/v1/widgets/{widget_id}/sessions`                    | `WidgetManager` | `createWidgetSession()`    | ✅ 已以路径 `widget_id` 为准，body 中该字段可省略          |
| `GET /_matrix/client/v1/widgets/{widget_id}/sessions`                     | `WidgetManager` | `getWidgetSessions()`      | ✅ 已封装                                                  |
| `GET /_matrix/client/v1/widgets/sessions/{session_id}`                    | `WidgetManager` | `getWidgetSession()`       | ✅ 已封装                                                  |
| `DELETE /_matrix/client/v1/widgets/sessions/{session_id}`                 | `WidgetManager` | `terminateWidgetSession()` | ✅ 已封装                                                  |
| `GET /_matrix/client/v3/rooms/{room_id}/widgets/{widget_id}/capabilities` | `WidgetManager` | `getWidgetCapabilities()`  | ✅ 已切换到 `v3` 前缀并对齐房间级路径                      |
| `PUT /_matrix/client/v3/rooms/{room_id}/widgets/{widget_id}/capabilities` | `WidgetManager` | `setWidgetCapabilities()`  | ✅ 已新增公开方法并按后端契约发送 `capabilities` 数组      |
| `POST /_matrix/client/v3/rooms/{room_id}/widgets/{widget_id}/send`        | `WidgetManager` | `sendWidgetMessage()`      | ✅ 已切换到 `v3` 前缀，并归一化为 `{ type, content }` body |

## 当前对齐结论

- `widget.rs` 的 17 个端点已独立建档，不再依赖总表中的路径族摘要。
- SDK 已覆盖大多数 `v1` widget CRUD、权限与会话接口，`v3` 房间级 `capabilities` / `send` 也已完成对齐。
- `createWidgetSession()` 仍可兼容携带 body 中的 `widget_id`，但后端现在以路径参数为单一真实来源；若两处不一致则返回 `400`。
- `v1` widget CRUD、权限与 session 查询/终止接口现已显式要求认证，不再是公开接口；对象级访问也已收敛为创建者、房间成员、管理员或显式授权用户。

## 封装覆盖率

- **后端路由总数**: 17 个端点
- **SDK 已封装**: 16/17
- **完全正确封装**: 16/17
- **路径前缀或契约细节不一致**: 0/17

## 代码定位

- 路由与处理器: `synapse-rust/src/web/routes/widget.rs`
- SDK 封装: `matrix-js-sdk/src/widget/index.ts`
