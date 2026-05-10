---
module: dm
generated_from: docs/api-contract/generated/modules/dm.json
generated_hash: sha256-8aaf2934301123187745584fe231dc31619c8311447648e282cd91acc842de48
ledger_schema: 1
last_reviewed: 2026-05-03
---

# DM 模块契约

> 审查来源: `synapse-rust/src/web/routes/dm.rs`

## 真实后端路由

| 方法 | 路径                                            | 说明                               | 认证 |
| ---- | ----------------------------------------------- | ---------------------------------- | ---- |
| POST | `/_matrix/client/r0/create_dm`                  | 创建私聊房间                       | 用户 |
| POST | `/_matrix/client/v3/create_dm`                  | 创建私聊房间                       | 用户 |
| GET  | `/_matrix/client/r0/direct`                     | 获取当前用户 direct map / 私聊房间 | 用户 |
| PUT  | `/_matrix/client/r0/direct/{room_id}`           | 更新某个房间的私聊映射             | 用户 |
| GET  | `/_matrix/client/v3/direct`                     | 获取当前用户 direct map / 私聊房间 | 用户 |
| PUT  | `/_matrix/client/v3/direct/{room_id}`           | 更新某个房间的私聊映射             | 用户 |
| GET  | `/_matrix/client/v3/rooms/{room_id}/dm`         | 判断房间是否为私聊                 | 用户 |
| GET  | `/_matrix/client/v3/rooms/{room_id}/dm/partner` | 获取私聊对端资料                   | 用户 |

## 请求/响应要点

| 路径                         | 主要请求参数                               | 主要响应字段                                    |
| ---------------------------- | ------------------------------------------ | ----------------------------------------------- |
| `create_dm`                  | `user_id` / 对端用户信息、可选私聊创建配置 | `{ "room_id": "..." }`                          |
| `direct`                     | 无                                         | direct map 或私聊列表                           |
| `direct/{room_id}`           | `partner_user_id` 或 direct map 更新内容   | 空对象 / 更新结果                               |
| `rooms/{room_id}/dm`         | `room_id`                                  | `{ "is_dm": true/false, ... }`                  |
| `rooms/{room_id}/dm/partner` | `room_id`                                  | `room_id` `user_id` `display_name` `avatar_url` |

## 代码可见稳定字段

- `GET /rooms/{room_id}/dm/partner` 处理器明确返回:
    - `room_id`
    - `user_id`
    - `display_name`
    - `avatar_url`

## 常见状态码

| 状态码 | 说明                         |
| ------ | ---------------------------- |
| `200`  | 请求成功                     |
| `400`  | 请求参数不合法               |
| `401`  | Token 无效或缺失             |
| `404`  | 房间不是私聊或找不到对端用户 |

## 错误语义对齐（BaseManager）

| 场景                | HTTP / errcode                         | SDK 统一错误类型 | 调用方建议                             |
| ------------------- | -------------------------------------- | ---------------- | -------------------------------------- |
| 未认证或 token 失效 | `401` / `M_UNKNOWN_TOKEN`              | `AuthError`      | 引导重新登录或刷新凭据，不重试业务请求 |
| 目标资源不存在      | `404` / `M_NOT_FOUND`                  | `NotFoundError`  | 视为业务态失败，提示房间或用户不存在   |
| 参数不合法          | `400` / `M_BAD_JSON` `M_INVALID_PARAM` | `ApiError`       | 修正请求参数后重试                     |
| 限流或短暂服务异常  | `429` / `M_LIMIT_EXCEEDED`，`5xx`      | `RetryableError` | 使用退避重试，保留幂等保护             |
| 其他 API 错误       | 其他 `4xx/5xx`                         | `ApiError`       | 按 `code` 与 `statusCode` 做兜底分支   |

## 典型 errcode

| errcode            | 常见 HTTP | 说明                               |
| ------------------ | --------- | ---------------------------------- |
| `M_UNKNOWN_TOKEN`  | `401`     | access token 无效、过期或缺失      |
| `M_NOT_FOUND`      | `404`     | 私聊房间、对端用户或映射记录不存在 |
| `M_BAD_JSON`       | `400`     | 请求体结构不符合接口要求           |
| `M_INVALID_PARAM`  | `400`     | 参数类型或取值非法                 |
| `M_LIMIT_EXCEEDED` | `429`     | 触发限流，需延迟重试               |

## 备注

- 这里记录的是后端真实私聊路由，不再把纯本地 `m.direct` 读写当成后端端点。
- SDK 若还封装本地 `m.direct` 读写，应视为客户端行为，不属于后端 HTTP 契约。

## SDK Manager 对应关系

> 更新日期: 2026-04-03

| 端点                              | SDK Manager            | 方法                         |
| --------------------------------- | ---------------------- | ---------------------------- |
| `POST /create_dm`                 | `DirectMessageManager` | `createDmRoom()`             |
| `GET /direct`                     | `DirectMessageManager` | `getDirectRoomsFromServer()` |
| `PUT /direct/{room_id}`           | `DirectMessageManager` | `updateDirectRoom()`         |
| `GET /rooms/{room_id}/dm`         | `DirectMessageManager` | `isDmRoomFromServer()`       |
| `GET /rooms/{room_id}/dm/partner` | `DirectMessageManager` | `getDmPartnerFromServer()`   |

### Manager 初始化

```typescript
import { createClient, extendMatrixClientWithManagers } from "matrix-js-sdk";

// 初始化所有 Manager
await extendMatrixClientWithManagers();

const client = createClient({ baseUrl: "https://matrix.org" });

// 获取 DirectMessageManager 实例
const dmManager = client.getDirectMessageManager();

// 使用专用 API 创建私聊房间
const roomId = await dmManager.createDmRoom("@user:matrix.org");

// 从服务器获取私聊映射
const dmMap = await dmManager.getDirectRoomsFromServer();

// 检查房间是否为私聊
const isDm = await dmManager.isDmRoomFromServer("!room:matrix.org");

// 获取私聊对端资料
const partner = await dmManager.getDmPartnerFromServer("!room:matrix.org");
console.log("Partner:", partner.display_name);
```

### DirectMessageManager 特性

- ✅ 事件系统 (`DMEvent`)
- ✅ 私聊房间缓存 (`Map<string, DmRoomInfo>`)
- ✅ 用户私聊映射缓存 (`Map<string, string>`)
- ✅ m.direct 正确读取位置（用户级别 account data）
- ✅ 专用 API 封装（create_dm, direct, dm/partner）
