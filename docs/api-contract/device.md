---
module: device
generated_from: docs/api-contract/generated/modules/device.json
generated_hash: sha256-54901cb52bad0602f86e7a1998da079cbbaf9c2ee56238e20daa34057566d9f1
ledger_schema: 1
last_reviewed: 2026-05-03
---

# Device 模块契约

> 审查来源: `synapse-rust/src/web/routes/device.rs`

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
| `PUT /devices/{device_id}`       | 返回 `{ "device_id", "display_name", "updated_ts" }`                                                                                                      |
| `DELETE /devices/{device_id}`    | 空对象                                                                                                                                                    |
| `POST /delete_devices`           | 空对象                                                                                                                                                    |
| `POST /keys/device_list_updates` | 不带 `since/from` 时返回 `{ "changed": [...], "left": [...] }`；带游标时返回 `{ "changed": [...], "deleted": [...], "left": [...], "stream_id": number }` |

## 请求体要点

| 路径                             | 请求字段                                                                   |
| -------------------------------- | -------------------------------------------------------------------------- |
| `POST /delete_devices`           | `device_ids` 或 `devices`，要求提供数组，数组元素不是字符串时返回 `400`    |
| `PUT /devices/{device_id}`       | `display_name`                                                             |
| `POST /keys/device_list_updates` | `users` 数组；可选 `since/from` 与 `to`，游标支持数字或带 `s` 前缀的字符串 |

## 常见状态码

| 状态码 | 说明                                               |
| ------ | -------------------------------------------------- |
| `200`  | 请求成功                                           |
| `400`  | 缺少 `display_name` 或 `device_ids/users` 格式错误 |
| `404`  | 设备不存在                                         |

## 代码定位

- 路由与处理器: `synapse-rust/src/web/routes/device.rs`

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
