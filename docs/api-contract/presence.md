---
module: presence
generated_from: docs/api-contract/generated/modules/presence.json
generated_hash: sha256-a7f87c52c89a7148c3f6444479aa79da4de731a2b689d6db45161521995ef48f
ledger_schema: 4
last_reviewed: 2026-05-03
---

# Presence 模块契约

> 审查来源: `synapse-rust/synapse-web/src/routes/presence.rs`

## 挂载版本

| 前缀                 | 路由                                                                       |
| -------------------- | -------------------------------------------------------------------------- |
| `/_matrix/client/v1` | `/presence/{user_id}/status`                                               |
| `/_matrix/client/v3` | `/presence/list`、`/presence/list/{user_id}`、`/presence/{user_id}/status` |

## 路由清单

| 方法 | 路径                                                   | 说明                         | 认证                         |
| ---- | ------------------------------------------------------ | ---------------------------- | ---------------------------- |
| GET  | `/_matrix/client/{v1,r0,v3}/presence/{user_id}/status` | 获取指定用户 presence 状态   | 用户；当前仅允许本人或管理员 |
| PUT  | `/_matrix/client/{v1,r0,v3}/presence/{user_id}/status` | 更新指定用户 presence 状态   | 用户                         |
| POST | `/_matrix/client/v3/presence/list`                     | 批量订阅/管理 presence list  | 用户                         |
| GET  | `/_matrix/client/v3/presence/list/{user_id}`           | 获取指定用户的 presence list | 用户                         |

## 响应与请求要点

- `GET /presence/{user_id}/status` 稳定返回 `presence` 与 `status_msg`；若用户存在但未写入状态，则回落为 `{ "presence": "offline", "status_msg": null }`
- `GET /presence/{user_id}/status` 当前与写入权限一致，仅允许本人或管理员访问；跨用户读取返回 `403`
- `PUT /presence/{user_id}/status` 请求体要求 `presence`，可选 `status_msg`
- `POST /presence/list` 请求体可包含 `subscribe`、`unsubscribe` 两个数组，响应为 `{ "presences": [...] }`
- `GET /presence/list/{user_id}` 返回 `{ "presences": [...] }`，元素稳定字段为 `user_id`、`presence`、`status_msg`、`last_active_ago`
- `presence/list` 是 v3 专有扩展；`GET /presence/list`、`POST /presence/list` 与 `GET /presence/list/{user_id}` 均已挂载，GET/POST 都返回 `{ "presences": [...] }`

## 常见状态码

| 状态码 | 说明                                              |
| ------ | ------------------------------------------------- |
| `200`  | 请求成功                                          |
| `400`  | presence 状态值不合法或消息过长                   |
| `401`  | Token 无效或缺失                                  |
| `403`  | 尝试读取/修改其他用户状态，或读取他人订阅表       |
| `404`  | `GET /presence/{user_id}/status` 的目标用户不存在 |

## 代码定位

- 路由声明: `synapse-rust/synapse-web/src/routes/presence.rs`
- 处理器: `synapse-rust/synapse-web/src/routes/handlers/presence.rs`

---

## SDK Manager 对应关系

> 更新日期: 2026-04-12
> 审计状态: ✅ 当前实现已与文档对齐

### Presence 状态

| 端点                             | SDK Manager       | 方法            | 状态      |
| -------------------------------- | ----------------- | --------------- | --------- |
| `GET /presence/{user_id}/status` | `PresenceManager` | `getPresence()` | ✅ 已封装 |
| `PUT /presence/{user_id}/status` | `PresenceManager` | `setPresence()` | ✅ 已封装 |

### Presence List

| 端点                           | SDK Manager       | 方法                    | 状态      |
| ------------------------------ | ----------------- | ----------------------- | --------- |
| `POST /presence/list`          | `PresenceManager` | `subscribeToPresence()` | ✅ 已封装 |
| `GET /presence/list/{user_id}` | `PresenceManager` | `getPresenceList()`     | ✅ 已封装 |

## 当前对齐结论

- `GET /presence/list/{user_id}` 已纳入当前契约，并由 `PresenceManager.getPresenceList()` 直接封装。
- `getPresence()`、`getSubscribedPresence()`、`getPresenceList()` 均按统一错误模型走 `normalizeError()`，不再以静默默认值掩盖请求失败。
- 当前文档仅保留可直接验证的现状，不再重复保留已关闭的历史审计项。
- `PresenceManager` 额外提供 `getPresences()`、`getPresenceListByIds()`、`unsubscribeFromPresence()`、
  `setOnline()`、`setOffline()`、`setUnavailable()`、`setBusy()`、`clearStatusMessage()` 等高层封装，
  这些能力仍全部落在 4 个已注册后端端点之上。
- `src/presence/index.ts` 已绑定生成的 `route-table` 路径模板，避免 `v3` presence 路径再次手写漂移。

## 封装覆盖率

- **后端语义端点数**: 4 个
- **SDK 已封装**: 4 个主端点 + 多个高层辅助方法
- **完全正确封装**: 4/4 (100%)

## 人工 Review 对齐

- `setPresence()` / `getPresence()` 统一走 `GET|PUT /presence/{user_id}/status`。
- `subscribeToPresence()` / `unsubscribeFromPresence()` / `getSubscribedPresence()` 统一走 `POST /presence/list`，
  通过请求体区分 `subscribe`、`unsubscribe` 和空载荷查询。
- `getPresenceList(targetUserId)` 直连 `GET /presence/list/{user_id}`。
- 当前 `r0` / `v1` presence 状态路由被视为兼容别名，SDK 默认使用 `v3` 主路径。
- **v10 对齐 (2026-06-09)**: `setPresence()` 新增前端校验，仅接受 `online`/`offline`/`unavailable` 三种状态，其他状态值抛出 `InvalidParamError`。

## DTO Definitions

> Source: `src/presence/__generated__/dto.ts`

```typescript
export type PresenceState = "online" | "offline" | "unavailable" | "away" | "busy";
export interface PresenceUserState {
    presence: PresenceState;
    status_msg?: string;
    last_active_ago?: number;
    currently_active?: boolean;
}
export interface PresenceUser {
    user_id: string;
    presence: PresenceState;
    status_msg?: string;
    last_active_ago?: number;
    currently_active?: boolean;
}
export interface SetPresenceRequest {
    presence: PresenceState;
    status_msg?: string;
}
export type GetPresenceResponse = PresenceUserState;
export interface PresenceListResponse {
    presences: PresenceUser[];
}
export interface SubscribePresenceRequest {
    subscribe: string[];
}
export interface UnsubscribePresenceRequest {
    unsubscribe: string[];
}
```

## 实现口径补充（2026-10-17 后端契约回灌）

### 服务开关与可见性

- `server.presence_enabled=false` 时全部 presence 端点返回 **403 `M_FORBIDDEN`**（`Presence is not supported on this server`），属于行政关闭，客户端不应重试。
- `GET /presence/{user_id}/status`：目标用户不存在 → 404 `M_NOT_FOUND`（服务端先判存在，避免用 403 探测用户是否存在）；读自己 → 允许；读他人 → 必须与其共享至少一个房间，否则 403 `M_FORBIDDEN`。
- `PUT /presence/{user_id}/status`：只能设置自己，`user_id` 非本人 → 403 `M_FORBIDDEN`。

### 字段语义

- `presence` 服务端只接受三值：`online` / `unavailable` / `offline`。DTO 中的 `away` / `busy` 只是 SDK 高层兼容值，服务端不接受；`setPresence()` 的前端校验同样只允许三值，其它值抛 `InvalidParamError`。
- `last_active_ago` 单位为**毫秒**；`presence=offline` 或无记录时为 `null`。
- `currently_active` 仅在近 5 分钟内有活动且 `presence=online` 时为 `true`，其余情况为 `null`（不是 `false`）。
- 用户存在但从未写入状态时，固定返回 `{ "presence": "offline", "status_msg": null, "last_active_ago": null, "currently_active": null }`；这是 200 的正常回落，不要与 404 混为一谈。
- `status_msg` 可为 `null`；超长 → 400（与消息体上限一致）。

### 请求体与订阅列表

- `POST /presence/list` 的请求体键是 **`subscribe` / `unsubscribe`**（不是 `invite` / `drop`）；响应为 `{ "presences": [...] }`。
- `GET /presence/list` 也返回 `{ "presences": [...] }` 状态快照（不是 user_id 数组），与 POST 同形；不要把它当成分页列表或 ID 列表。
- `GET /presence/list`、`POST /presence/list`、`GET /presence/list/{user_id}` 的元素字段均为 `user_id`、`presence`、`status_msg`、`last_active_ago`、`currently_active`。
- 订阅与返回都按「共享房间」过滤：不可见用户不会被订阅，也不会出现在结果中；已订阅但查不到状态的用户会以 `presence: "offline"` 补齐一条，保证结果数量与订阅一致。
