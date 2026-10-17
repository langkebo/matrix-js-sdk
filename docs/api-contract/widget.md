---
module: widget
generated_from: docs/api-contract/generated/modules/widget.json
generated_hash: sha256-644b19eb411b071cf1e02fe2499f761fefbd36efb02510bfd72ddefe952b67f0
ledger_schema: 4
last_reviewed: 2026-05-03
---

# Widget 模块契约

> 版本: v1.0.0
> 更新日期: 2026-04-13
> 对应 SDK 模块: `src/widget/index.ts`
> 审查来源: `synapse-rust/synapse-web/src/routes/widget.rs`
> 审计状态: ✅ 已拆分独立契约，后端 `v1/v3` widget 鉴权与 session 路径语义已对齐，SDK 直连端点已补齐

## 挂载版本

| 前缀                 | 路由                                                                                                                                                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/_matrix/vendor/v1` | `/rooms/{room_id}/widgets`、`/rooms/{room_id}/widgets/jitsi/config`、`/rooms/{room_id}/widgets/{widget_id}/capabilities`、`/widgets`、`/widgets/sessions/{session_id}`、`/widgets/{widget_id}`、`/widgets/{widget_id}/config`、`/widgets/{widget_id}/permissions`、`/widgets/{widget_id}/permissions/{user_id}`、`/widgets/{widget_id}/sessions` |

## 路由清单

| 方法   | 路径                                                                  | 说明               | 认证 |
| ------ | --------------------------------------------------------------------- | ------------------ | ---- |
| POST   | `/_matrix/vendor/v1/widgets`                                          | 创建小组件         | 用户 |
| GET    | `/_matrix/vendor/v1/widgets/{widget_id}`                              | 获取小组件详情     | 用户 |
| PUT    | `/_matrix/vendor/v1/widgets/{widget_id}`                              | 更新小组件         | 用户 |
| DELETE | `/_matrix/vendor/v1/widgets/{widget_id}`                              | 删除小组件         | 用户 |
| GET    | `/_matrix/vendor/v1/widgets/{widget_id}/config`                       | 获取小组件配置     | 用户 |
| GET    | `/_matrix/vendor/v1/rooms/{room_id}/widgets`                          | 获取房间小组件列表 | 用户 |
| GET    | `/_matrix/vendor/v1/rooms/{room_id}/widgets/jitsi/config`             | 获取 Jitsi 配置    | 公开 |
| GET    | `/_matrix/vendor/v1/rooms/{room_id}/widgets/{widget_id}/capabilities` | 获取房间小组件能力 | 用户 |
| PUT    | `/_matrix/vendor/v1/rooms/{room_id}/widgets/{widget_id}/capabilities` | 设置房间小组件能力 | 用户 |
| POST   | `/_matrix/vendor/v1/widgets/{widget_id}/permissions`                  | 设置小组件权限     | 用户 |
| GET    | `/_matrix/vendor/v1/widgets/{widget_id}/permissions`                  | 获取小组件权限列表 | 用户 |
| DELETE | `/_matrix/vendor/v1/widgets/{widget_id}/permissions/{user_id}`        | 删除小组件权限     | 用户 |
| POST   | `/_matrix/vendor/v1/widgets/{widget_id}/sessions`                     | 创建小组件会话     | 用户 |
| GET    | `/_matrix/vendor/v1/widgets/{widget_id}/sessions`                     | 获取小组件会话列表 | 用户 |
| GET    | `/_matrix/vendor/v1/widgets/sessions/{session_id}`                    | 获取单个会话       | 用户 |
| DELETE | `/_matrix/vendor/v1/widgets/sessions/{session_id}`                    | 终止会话           | 用户 |

## 请求体与稳定响应

### `POST /_matrix/vendor/v1/widgets`

- 请求体稳定字段: `room_id?`、`widget_type`、`url`、`name`、`data?`
- 若传入 `room_id`，处理器会先校验房间存在性
- 成功时返回扁平的 `WidgetApiResponse`，字段直接位于顶层，不包裹在 `widget` 键内

### `GET/PUT/DELETE /_matrix/vendor/v1/widgets/{widget_id}`

- `GET` 与 `PUT` 成功时均返回扁平的 `WidgetApiResponse`，字段直接位于顶层，不包裹在 `widget` 键内
- `DELETE` 成功时返回 `{ "deleted": true }`
- `PUT` 请求体可选字段: `url`、`name`、`data`
- 三个端点都要求登录，并校验请求用户是否为 widget 创建者、房间成员、管理员或显式授权用户

### `GET /_matrix/vendor/v1/widgets/{widget_id}/config`

- 稳定字段: `widget_id`、`room_id`、`url`、`name`、`data`、`type`
- 要求登录，并沿用 widget 读取权限判断

### `GET /_matrix/vendor/v1/rooms/{room_id}/widgets`

- 成功时返回 `{ "total": number, "widgets": [...] }`
- 要求登录，且请求用户必须是房间成员或管理员

### `GET /_matrix/vendor/v1/rooms/{room_id}/widgets/jitsi/config`

- 稳定字段: `conf_id`、`name`、`domain`、`app_id`、`jwt`

### `GET/PUT /_matrix/vendor/v1/rooms/{room_id}/widgets/{widget_id}/capabilities`

- 两个处理器都会校验请求用户是否为房间成员或管理员
- 若 widget 不属于该房间，返回 `400`
- `GET` 稳定字段: `capabilities`、`widget_id`、`room_id`
- `PUT` 请求体为 `{ "capabilities": string[] }`

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

| 后端端点                                                                  | SDK Manager     | 方法                       | 现状                                                  |
| ------------------------------------------------------------------------- | --------------- | -------------------------- | ----------------------------------------------------- |
| `POST /_matrix/vendor/v1/widgets`                                         | `WidgetManager` | `createWidget()`           | ✅ 请求路径与主要字段一致                             |
| `GET /_matrix/vendor/v1/widgets/{widget_id}`                              | `WidgetManager` | `getWidget()`              | ✅ 已封装                                             |
| `PUT /_matrix/vendor/v1/widgets/{widget_id}`                              | `WidgetManager` | `updateWidget()`           | ✅ 已封装                                             |
| `DELETE /_matrix/vendor/v1/widgets/{widget_id}`                           | `WidgetManager` | `removeWidget()`           | ✅ 已封装                                             |
| `GET /_matrix/vendor/v1/rooms/{room_id}/widgets`                          | `WidgetManager` | `getRoomWidgets()`         | ✅ 已封装                                             |
| `GET /_matrix/vendor/v1/widgets/{widget_id}/config`                       | `WidgetManager` | `getWidgetConfig()`        | ✅ 已封装                                             |
| `GET /_matrix/vendor/v1/rooms/{room_id}/widgets/jitsi/config`             | `WidgetManager` | `getJitsiConfig()`         | ✅ 已封装                                             |
| `GET /_matrix/vendor/v1/widgets/{widget_id}/permissions`                  | `WidgetManager` | `getWidgetPermissions()`   | ✅ 已封装                                             |
| `POST /_matrix/vendor/v1/widgets/{widget_id}/permissions`                 | `WidgetManager` | `setWidgetPermission()`    | ✅ 已封装                                             |
| `DELETE /_matrix/vendor/v1/widgets/{widget_id}/permissions/{user_id}`     | `WidgetManager` | `deleteWidgetPermission()` | ✅ 已封装                                             |
| `POST /_matrix/vendor/v1/widgets/{widget_id}/sessions`                    | `WidgetManager` | `createWidgetSession()`    | ✅ 已以路径 `widget_id` 为准，body 中该字段可省略     |
| `GET /_matrix/vendor/v1/widgets/{widget_id}/sessions`                     | `WidgetManager` | `getWidgetSessions()`      | ✅ 已封装                                             |
| `GET /_matrix/vendor/v1/widgets/sessions/{session_id}`                    | `WidgetManager` | `getWidgetSession()`       | ✅ 已封装                                             |
| `DELETE /_matrix/vendor/v1/widgets/sessions/{session_id}`                 | `WidgetManager` | `terminateWidgetSession()` | ✅ 已封装                                             |
| `GET /_matrix/vendor/v1/rooms/{room_id}/widgets/{widget_id}/capabilities` | `WidgetManager` | `getWidgetCapabilities()`  | ✅ 已切换到 `v3` 前缀并对齐房间级路径                 |
| `PUT /_matrix/vendor/v1/rooms/{room_id}/widgets/{widget_id}/capabilities` | `WidgetManager` | `setWidgetCapabilities()`  | ✅ 已新增公开方法并按后端契约发送 `capabilities` 数组 |

## 当前对齐结论

- `widget.rs` 的 16 个端点已独立建档，不再依赖总表中的路径族摘要。
- SDK 已覆盖 `v1` widget CRUD、权限与会话接口，以及房间级 `capabilities` 路径。
- `createWidgetSession()` 仍可兼容携带 body 中的 `widget_id`，但后端现在以路径参数为单一真实来源；若两处不一致则返回 `400`。
- `v1` widget CRUD、权限与 session 查询/终止接口现已显式要求认证，不再是公开接口；对象级访问也已收敛为创建者、房间成员、管理员或显式授权用户。
- ISSUE-13 第二批后**只有一条**创建链路：`POST /_matrix/vendor/v1/widgets`（`WidgetManager.createWidget()` 走它；此前后端同时注册 `v3 /widgets/create` 与 `v1 /widgets` 两条同 handler 路径，已按铁律 1/2 合并，重复路径的 SDK 侧方法、route-table 条目与契约差集登记项已同批删除）。

## 封装覆盖率

- **后端路由总数**: 16 个端点
- **SDK 已封装**: 16/16
- **完全正确封装**: 16/16
- **路径前缀或契约细节不一致**: 0/16

## 人工 Review 对齐

- `src/widget/index.ts` 的 `createWidget()` 走 `POST /_matrix/vendor/v1/widgets`（`widgets/create` 已合并，不再存在）。
- `createWidget()` 统一映射 `widget_type` / `room_id` / `data` 字段，避免再次分叉。
- 单测已覆盖 `createWidget()` 成功路径和参数校验。

## 代码定位

- 路由与处理器: `synapse-rust/synapse-web/src/routes/widget.rs`
- SDK 封装: `matrix-js-sdk/src/widget/index.ts`

## 实现口径补充（2026-10-17 后端契约回灌）

> 本节依据 `synapse-rust/docs/sdk/rtc.md` 的 Widget API 章节回灌。正文的路由表、端点计数、覆盖率与日期保持不变；若正文与本节冲突，以本节为准。

### `POST /widgets` 必填字段

- `room_id`、`widget_type`、`url`、`name` 四个字段都必填，缺失或空串返回 `400 M_BAD_JSON`。
- `data` 可选，默认 `{}`。
- 正文“请求体稳定字段: `room_id?`”中的 `room_id` 实际为必填，不能省略。

### URL 与权限

- `url` 只允许 `http` / `https` 且必须有 host；`javascript:`、`data:` 等 scheme 返回 `400 M_BAD_JSON`。
- 创建者必须是房间成员，且是房间管理员或房间创建者，否则返回 `403 M_FORBIDDEN`。
- 房间不存在返回 `404 M_NOT_FOUND`。
- 单条响应 `WidgetApiResponse` 的字段为 `widget_id`、`room_id`、`user_id`、`type`、`url`、`name`、`data`、`creator`、`active`；请求里的 `widget_type` 在响应里叫 `type`。

### 房间列表实体

- `GET /rooms/{room_id}/widgets` 返回 `{total, widgets}`，其中 `widgets` 的实体字段为 `id`（数字）、`widget_id`、`room_id`、`user_id`、`widget_type`、`url`、`name`、`data`、`created_ts`、`updated_ts`、`is_active`。
- 列表实体与单条响应的命名不一致：单条用 `type` / `creator` / `active`，列表用 `widget_type` / `user_id` / `is_active`，且列表额外带 `id`、`created_ts`、`updated_ts`。

### Jitsi 配置

- `GET /rooms/{room_id}/widgets/jitsi/config` 返回占位值 `{conf_id, name: "Jitsi Conference", domain: "meet.jit.si", app_id: null, jwt: null}`，不读取真实 Jitsi 配置。
- `conf_id` 由 `room_id` 去掉 `!`、把 `:` 换成 `_` 后拼 `_jitsi_conference` 得到，不是服务端生成的会议 ID。

### 会话

- 创建会话请求 `{widget_id?, device_id?, expires_in_ms?}`；`expires_in_ms` 单位是毫秒。
- body 中的 `widget_id` 若存在必须与路径一致，否则返回 `400`。
- 响应为 `{session: {...}}`，会话实体含 `id`、`session_id`、`widget_id`、`user_id`、`device_id`、`created_ts`、`last_active_ts`、`expires_at`、`is_active`；`created_ts`、`last_active_ts`、`expires_at` 均为毫秒。
- 单会话路径是 `/widgets/sessions/{session_id}`，不是 `/widgets/{widget_id}/sessions/{session_id}`。
- `GET /widgets/{widget_id}/sessions` 返回 `{sessions, total}`，需要 `write` 权限；`DELETE /widgets/sessions/{session_id}` 返回 `{terminated: true}`。

### 路由归属与能力发现

- Widget 全部挂在 `/_matrix/vendor/v1`，不存在 `/_matrix/client/v1` / `/_matrix/client/v3` 别名；历史上的 `/client/v3/widgets/create`、`/client/v1/widgets` 已被删除。
- `/versions` 的 `unstable_features` 不声明 widget 能力位；能力探测只能依据 `POST /_matrix/vendor/v1/widgets` 是否存在，或直接调用后按 404 处理。
- `PUT /rooms/{room_id}/widgets/{widget_id}/capabilities` 只接受 `{"capabilities": [...]}`（`deny_unknown_fields`）；widget 不属于该房间时返回 `400`。
