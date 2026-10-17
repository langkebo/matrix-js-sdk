---
module: device
generated_from: docs/api-contract/generated/modules/device.json
generated_hash: sha256-a2f2436a9c26f9b2cc6e6f124df2aa0cd91b07101278312bfdfb8522b57aa479
ledger_schema: 4
last_reviewed: 2026-05-03
---

# Device 模块契约

> 审查来源: `synapse-rust/synapse-web/src/routes/device.rs`
> 审计状态: ✅ `DeviceManager` 已覆盖全部 6 条主端点，并绑定生成 `DevicePathPattern`

## 挂载版本

| 前缀                 | 路由                                                    |
| -------------------- | ------------------------------------------------------- |
| `/_matrix/client/r0` | `devices`、`delete_devices`、`keys/device_list_updates` |
| `/_matrix/client/v3` | `devices`、`delete_devices`、`keys/device_list_updates` |

## 路由清单

| 方法   | 路径                                               | 说明                 | 认证 |
| ------ | -------------------------------------------------- | -------------------- | ---- |
| GET    | `/_matrix/client/{r0,v3}/devices`                  | 获取当前用户全部设备 | 用户 |
| POST   | `/_matrix/client/{r0,v3}/delete_devices`           | 批量删除设备         | 用户 |
| GET    | `/_matrix/client/{r0,v3}/devices/{device_id}`      | 获取单设备详情       | 用户 |
| PUT    | `/_matrix/client/{r0,v3}/devices/{device_id}`      | 更新设备显示名       | 用户 |
| DELETE | `/_matrix/client/{r0,v3}/devices/{device_id}`      | 删除单设备           | 用户 |
| POST   | `/_matrix/client/{r0,v3}/keys/device_list_updates` | 查询多用户设备变更   | 用户 |

## 代码中可见稳定响应

| 路径                             | 响应要点                                                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /devices`                   | `{ "devices": [{ "device_id", "display_name", "last_seen_ts", "last_seen_ip" }, ...] }`                                                                   |
| `GET /devices/{device_id}`       | 同时返回扁平字段和嵌套 `device` 对象                                                                                                                      |
| `PUT /devices/{device_id}`       | 返回 `{}`                                                                                                                                                 |
| `DELETE /devices/{device_id}`    | 空对象                                                                                                                                                    |
| `POST /delete_devices`           | 空对象                                                                                                                                                    |
| `POST /keys/device_list_updates` | 不带 `since/from` 时返回 `{ "changed": [...], "left": [...] }`；带游标时返回 `{ "changed": [...], "deleted": [...], "left": [...], "stream_id": number }` |

## 请求体要点

| 路径                             | 请求字段                                                                   |
| -------------------------------- | -------------------------------------------------------------------------- |
| `POST /delete_devices`           | `devices`（字符串数组，唯一契约字段名）；数组元素不是字符串时返回 `400`    |
| `PUT /devices/{device_id}`       | `display_name`                                                             |
| `POST /keys/device_list_updates` | `users` 数组；可选 `since/from` 与 `to`，游标支持数字或带 `s` 前缀的字符串 |

## 常见状态码

| 状态码 | 说明                                                                                |
| ------ | ----------------------------------------------------------------------------------- |
| `200`  | 请求成功                                                                            |
| `400`  | 缺少 `display_name` 或 `devices` 格式错误，`display_name` 长度超过 100 字符（m-13） |
| `404`  | 设备不存在                                                                          |

## 代码定位

- 路由与处理器: `synapse-rust/synapse-web/src/routes/device.rs`

## SDK Manager 对应关系

> 更新日期: 2026-04-03

| 端点                             | SDK Manager     | 方法                                                       |
| -------------------------------- | --------------- | ---------------------------------------------------------- |
| `GET /devices`                   | `DeviceManager` | `getDevices()`                                             |
| `POST /delete_devices`           | `DeviceManager` | `deleteDevices()`                                          |
| `GET /devices/{device_id}`       | `DeviceManager` | `getDevice()`                                              |
| `PUT /devices/{device_id}`       | `DeviceManager` | `updateDevice()` / `setDeviceDetails()` / `renameDevice()` |
| `DELETE /devices/{device_id}`    | `DeviceManager` | `deleteDevice()`                                           |
| `POST /keys/device_list_updates` | `DeviceManager` | `getDeviceListUpdates()`                                   |

### Manager 初始化

```typescript
import { createClient, extendMatrixClientWithManagers } from "matrix-js-sdk";

// 初始化所有 Manager
await extendMatrixClientWithManagers();

const client = createClient({ baseUrl: "https://matrix.org" });

// 获取 DeviceManager 实例
const deviceManager = client.getDeviceManager();

// 获取所有设备
const devices = await deviceManager.getDevices();

// 查询多用户设备变更
const updates = await deviceManager.getDeviceListUpdates(["@user1:matrix.org", "@user2:matrix.org"]);
console.log("Changed:", updates.changed);
console.log("Left:", updates.left);
```

### DeviceManager 特性

- ✅ 事件系统 (`DeviceEvent`)
- ✅ 设备缓存 (`Map<string, IDevice>`)
- ✅ UIA 错误处理 (`UIAError`)
- ✅ 参数验证 (`InvalidParamError`)
- ✅ 当前设备保护（禁止删除当前设备）

## SDK 对齐结论

- `src/device/index.ts` 现已将 `devices`、`delete_devices`、`keys/device_list_updates` 相关主路径绑定到生成的 `DevicePathPattern`。
- 已绑定入口包括 `getDevices()`、`getDevice()`、`updateDevice()`、`deleteDevice()`、`deleteDevices()`、`getDeviceListUpdates()`。
- `setDeviceDetails()` 与 `renameDevice()` 继续复用 `updateDevice()`，不单独引入额外契约面。
- SDK 默认收敛到 `/_matrix/client/v3` 主路径；`r0` 兼容前缀由后端共享处理器承接，不再视为人工封装缺口。
- **v10 对齐 (2026-06-09)**: `updateDevice()` 新增 `display_name` ≤100 字符前端校验（m-13），超长时抛出 `ValidationError`。

## 覆盖率口径

- **Ledger 契约端点数**: 12
- **SDK 主路径覆盖**: 12/12
- **已绑定生成路由模板**: 12/12
- **契约覆盖率**: 100%

## DTO Definitions

> Source: `src/device/__generated__/dto.ts`

```typescript
export interface DeviceInfo {
    device_id: string;
    display_name?: string;
    last_seen_ip?: string;
    last_seen_ts?: number;
    user_id?: string;
}
export interface DeviceListResponse {
    devices: DeviceInfo[];
}
export interface UpdateDeviceRequest {
    display_name?: string;
}
export interface AuthDict {
    type: string;
    session?: string;
    [key: string]: unknown;
}
export interface DeleteDeviceRequest {
    auth?: AuthDict;
}
export interface DeleteDevicesRequest {
    devices: string[];
    auth?: AuthDict;
}
export interface DeviceData {
    display_name?: string;
    last_seen_ts?: number;
    last_seen_ip?: string;
}
export interface DeviceChange {
    user_id: string;
    device_id: string;
    device_data: DeviceData;
}
export interface DeviceListUpdatesRequest {
    users: string[];
}
export interface DeviceListUpdatesResponse {
    changed: DeviceChange[];
    left: string[];
}
```

## 实现口径补充（2026-10-17 后端契约回灌）

### 版本前缀

- 6 条设备端点（`GET /devices`、`POST /delete_devices`、`GET|PUT|DELETE /devices/{device_id}`、`POST /keys/device_list_updates`）全部注册在 `/_matrix/client/v3` 下；上方路由表中的 `{r0,v3}` 是后端共享处理器的兼容写法，SDK 一律以 v3 为主路径。

### 单设备读写

- `PUT /devices/{device_id}` 成功返回 **`{}`**，不要按 `{device_id, display_name, updated_ts}` 解析。
- `GET /devices/{device_id}` 同时返回嵌套 `device` 对象与顶层平铺字段，且**不含 `last_seen_ip`**（只有 `GET /devices` 列表才带该字段）。稳妥写法：`const device = resp.device ?? resp`。
- 设备不存在或不属于调用者 → **404 `M_NOT_FOUND`**。服务端刻意不用 `M_UNKNOWN_DEVICE`（该码属 MSC4326 范围，本服务未启用），客户端不要按该码分支。

### 删除设备

- `DELETE /devices/{device_id}` 与 `POST /delete_devices` 都需要 UIA；不带 `auth` → 401 + `flows`/`session`。
- 例外：调用者身份是 Application Service（`auth_user.appservice_id` 非空）时跳过 UIA，直接删除设备。
- 批量删除的请求体字段名是 **`devices`**（字符串数组），不存在 `device_ids` 字段；数组元素不是字符串 → 400。
- 两个删除端点成功响应均为 `{}`。
- 删除设备会同时吊销该设备的 token；被删除设备的下一次请求收到 401 `M_UNKNOWN_TOKEN`，客户端应清理本地会话并重新登录。
- 设备被其它设备删除后，E2EE 客户端必须重新执行 `/keys/query` 同步设备清单（服务端会通过 `/sync` 的 `device_lists.changed` 与 `device_list_changes` 通知）。

### 当前设备保护

- 「禁止删除当前设备」是 SDK `DeviceManager` 的前端策略，不是后端限制；后端只按设备归属做 404 校验。绕过 SDK 直接调用删除端点时，服务端会照常删除该设备并吊销其 token。
