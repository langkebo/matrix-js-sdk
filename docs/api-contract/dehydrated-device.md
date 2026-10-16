---
module: dehydrated_device
generated_from: docs/api-contract/generated/modules/dehydrated_device.json
generated_hash: sha256-d26c63dd0f9471760473d2a3b62379e7266c754f6eb7362ec0bd63fc4e59e840
ledger_schema: 4
last_reviewed: 2026-10-15
---

# Dehydrated Device (MSC3814) API 契约

> 后端代码: `synapse-rust/synapse-web/src/routes/handlers/dehydrated_device.rs`
> 装配入口: `synapse-rust/synapse-web/src/routes/assembly.rs`（以独立 sub-router 挂载）
> ledger 模块名: `dehydrated_device`

## 一、模块概览

MSC3814「脱水设备」：把 E2EE 密钥托管在服务端，使客户端在没有本地密钥的新设备上仍能解密历史消息。
SDK 侧封装在 `src/dehydrated-device/index.ts`，入口为 `MatrixClient.getDehydratedDeviceManager()`。

**端点前缀**: `/_matrix/client/unstable/org.matrix.msc3814.v1`

| #   | 方法   | 路径                                    | SDK 方法                                |
| --- | ------ | --------------------------------------- | --------------------------------------- |
| 1   | PUT    | `/dehydrated_device`                    | `createDevice()` / `updateDeviceData()` |
| 2   | GET    | `/dehydrated_device`                    | `getDevice()` / `getDevices()`          |
| 3   | DELETE | `/dehydrated_device`                    | `deleteDevice()`                        |
| 4   | GET    | `/dehydrated_device/status`             | `getDeviceStatus()`                     |
| 5   | POST   | `/dehydrated_device/{device_id}/events` | `claimDevice()`                         |
| 6   | GET    | `/dehydrated_device/{device_id}/events` | —（有意不封装，见下）                   |

> ⚠️ 第 6 条是 **Synapse v1.157 兼容别名**（游标走 query：`next_batch` / `limit`），后端源码注释标注
> 「弃用中」；MSC3814 规范形态是第 5 条（POST，游标放 JSON body）。SDK 只封装规范形态 ⇒
> 第 6 条**有意不封装**（与 `delayed-events.md` 中 action-in-PATH 端点同款处置）。

## 二、审计结论（2026-10-15）

### 2.1 曾存在一条后端不存在的路径

`getDeviceEvent()` 打过 `GET …/{device_id}/initial_device`。该路径段在**四处均不存在**：

- 上游 Synapse（`rest/client/devices.py` 里带 `device_id` 的路由**只有** `…/events`）；
- 上游 matrix-js-sdk（`rust-crypto/DehydratedDeviceManager.ts` 中 `initial_device` 出现 **0** 次）；
- MSC3814 / ruma `dehydrated_device::get_events`；
- 本仓后端与 ledger。

实为「**把请求体字段名 `initial_device_display_name` 误当路径段**」⇒ 该方法**已删除**；
其能力已被 `getDevice()`（读 `device_data`）与 `claimDevice()`（拉 to-device 事件队列）覆盖。

### 2.2 该模块此前完全不受契约管辖（已修复）

它的路由原先由 `assembly::create_router` 直挂 ⇒ 在 ledger 里归 **`assembly` 桶** ⇒
**没有独立 ledger 模块** ⇒ SDK codegen 的模块枚举（源为本文档索引 `CONTRACT_INDEX.md` 的文档链接）
**从不包含它** ⇒ 该目录**从未生成 route-table、从未有 `PathAssert`** —— 这正是 2.1 那条错路径
能长期隐藏的**根因**。

后端已于 2026-10-15 把该族改为**独立 sub-router**（`registered_by: dehydrated_device`）⇒
ledger 独立成桶 ⇒ 本页与 `src/dehydrated-device/__generated__/route-table.ts` 随之建立，
manager 的 **7 处**调用点接入 `PathAssert` 编译期断言（剥离类型 `StripMsc3814`）。

## 三、DTO

以下形状由后端 handler（`handlers/dehydrated_device.rs`）与 MSC3814 定义；
SDK 侧 `src/dehydrated-device/index.ts` 的类型与之对应。

```ts
/** 脱水设备的密钥数据：算法标识 + （客户端加密的）账户数据。 */
export interface DehydratedDeviceData {
    algorithm: string;
    account: string;
}

/** `PUT …/dehydrated_device` 的请求体。 */
export interface DehydratedDevicePutRequest {
    device_data: DehydratedDeviceData;
    /** 创建时希望使用的设备显示名（可选）。 */
    initial_device_display_name?: string;
}

/** `PUT …/dehydrated_device` 的响应。 */
export interface DehydratedDevicePutResponse {
    device_id: string;
}

/** `GET …/dehydrated_device` 的响应。 */
export interface DehydratedDeviceGetResponse {
    device_id: string;
    device_data: DehydratedDeviceData;
}

/** 已注册的脱水设备（`GET …/dehydrated_device/status` 的载荷）。 */
export interface DehydratedDeviceStatus {
    device_id: string;
    device_data: DehydratedDeviceData;
}

/** `GET …/dehydrated_device/status` 的响应；未注册时 `dehydrated_device` 省略。 */
export interface DehydratedDeviceStatusResponse {
    dehydrated_device?: DehydratedDeviceStatus;
}

/** `POST …/{device_id}/events` 的请求体：仅携带分页游标。 */
export interface DehydratedDeviceEventsRequest {
    next_batch?: string;
}

/** 队列中的一条 to-device 事件。 */
export interface DehydratedDeviceToDeviceEvent {
    type: string;
    sender: string;
    content: IContent;
}

/** `…/{device_id}/events` 的响应：待认领的 to-device 事件 + 下一页游标。 */
export interface DehydratedDeviceEventsResponse {
    events: DehydratedDeviceToDeviceEvent[];
    next_batch?: string;
}
```

## 四、SDK 覆盖率口径

- **后端 Ledger 路由总数**: 6（`docs/api-contract/generated/modules/dehydrated_device.json` 的 `entry_count`）
- **SDK 已封装**: 5（第 6 条为弃用兼容别名，有意不封装）
- **契约覆盖率**: 100%（= 5/5「应封装」；口径与 `delayed-events.md` 一致 —— **有意不封装的不计入分母**）

## 五、变更历史

| 日期       | 变更                                                                                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-15 | 新建本页。`getDeviceEvent()` 删除（`6de305a16`）；7 处调用点接入 `PathAssert`（`fe65d592a`）。后端把该族拆为独立 `registered_by` ⇒ 本模块首次进入 codegen 枚举 |
