# DM 模块契约

> 审查来源: `synapse-rust/src/web/routes/dm.rs`

## 真实后端路由

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/_matrix/client/r0/create_dm` | 创建 DM 房间 | 用户 |
| POST | `/_matrix/client/v3/create_dm` | 创建 DM 房间 | 用户 |
| GET | `/_matrix/client/r0/direct` | 获取当前用户 direct map / DM 房间 | 用户 |
| PUT | `/_matrix/client/r0/direct/{room_id}` | 更新某个房间的 DM 映射 | 用户 |
| GET | `/_matrix/client/v3/direct` | 获取当前用户 direct map / DM 房间 | 用户 |
| PUT | `/_matrix/client/v3/direct/{room_id}` | 更新某个房间的 DM 映射 | 用户 |
| GET | `/_matrix/client/v3/rooms/{room_id}/dm` | 判断房间是否为 DM | 用户 |
| GET | `/_matrix/client/v3/rooms/{room_id}/dm/partner` | 获取 DM 对端资料 | 用户 |

## 请求/响应要点

| 路径 | 主要请求参数 | 主要响应字段 |
|------|--------------|--------------|
| `create_dm` | `user_id` / 对端用户信息、可选 DM 创建配置 | `{ "room_id": "..." }` |
| `direct` | 无 | direct map 或 DM 列表 |
| `direct/{room_id}` | `partner_user_id` 或 direct map 更新内容 | 空对象 / 更新结果 |
| `rooms/{room_id}/dm` | `room_id` | `{ "is_dm": true/false, ... }` |
| `rooms/{room_id}/dm/partner` | `room_id` | `room_id` `user_id` `display_name` `avatar_url` |

## 代码可见稳定字段

- `GET /rooms/{room_id}/dm/partner` 处理器明确返回:
  - `room_id`
  - `user_id`
  - `display_name`
  - `avatar_url`

## 常见状态码

| 状态码 | 说明 |
|--------|------|
| `200` | 请求成功 |
| `400` | 请求参数不合法 |
| `401` | Token 无效或缺失 |
| `404` | 房间不是 DM 或找不到对端用户 |

## 备注

- 这里记录的是后端真实 DM 路由，不再把纯本地 `m.direct` 读写当成后端端点。
- SDK 若还封装本地 `m.direct` 读写，应视为客户端行为，不属于后端 HTTP 契约。

## SDK Manager 对应关系

> 更新日期: 2026-04-03

| 端点 | SDK Manager | 方法 |
|------|-------------|------|
| `POST /create_dm` | `DirectMessageManager` | `createDmRoom()` |
| `GET /direct` | `DirectMessageManager` | `getDirectRoomsFromServer()` |
| `PUT /direct/{room_id}` | `DirectMessageManager` | `updateDirectRoom()` |
| `GET /rooms/{room_id}/dm` | `DirectMessageManager` | `isDmRoomFromServer()` |
| `GET /rooms/{room_id}/dm/partner` | `DirectMessageManager` | `getDmPartnerFromServer()` |

### Manager 初始化

```typescript
import { createClient, extendMatrixClientWithManagers } from "matrix-js-sdk";

// 初始化所有 Manager
await extendMatrixClientWithManagers();

const client = createClient({ baseUrl: "https://matrix.org" });

// 获取 DirectMessageManager 实例
const dmManager = client.getDirectMessageManager();

// 使用专用 API 创建 DM 房间
const roomId = await dmManager.createDmRoom("@user:matrix.org");

// 从服务器获取 DM 映射
const dmMap = await dmManager.getDirectRoomsFromServer();

// 检查房间是否为 DM
const isDm = await dmManager.isDmRoomFromServer("!room:matrix.org");

// 获取 DM 对端资料
const partner = await dmManager.getDmPartnerFromServer("!room:matrix.org");
console.log("Partner:", partner.display_name);
```

### DirectMessageManager 特性

- ✅ 事件系统 (`DMEvent`)
- ✅ DM 房间缓存 (`Map<string, DmRoomInfo>`)
- ✅ 用户 DM 映射缓存 (`Map<string, string>`)
- ✅ m.direct 正确读取位置（用户级别 account data）
- ✅ 专用 API 封装（create_dm, direct, dm/partner）
