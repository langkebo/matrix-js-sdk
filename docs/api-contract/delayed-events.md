---
module: delayed_events
generated_from: docs/api-contract/generated/modules/delayed_events.json
generated_hash: sha256-3927e06121919797158641bf11b15f0bef741083f5b53a214e8db307267ef019
ledger_schema: 4
last_reviewed: 2026-10-15
---

# Delayed Events (MSC4140) API 契约文档

> 后端代码: `synapse-rust/synapse-web/src/routes/delayed_events.rs`
> 装配入口: `synapse-rust/synapse-web/src/routes/assembly.rs`
> SDK 入口: `src/delayed-events/index.ts`
> 更新日期: 2026-10-15
> 挂载版本: `unstable`（`org.matrix.msc4140`）

## 一、当前审计结论

- `generated/modules/delayed_events.json` 当前记录 **7** 条后端路由——本页是
  **2026-10-15 新收编**的模块：此前该模块既未被 `LEDGER_MODULE_ALIASES` 登记、
  也未在后端文档章节映射里指向任何 SDK 目录，因此 7 条路由长期处于
  **无 route-table 约束**状态（WAIVED 豁免，理由写作「1 route; manager gates on
  an unstable feature and needs no table」，该理由在 2026-10-14 后端补齐端点后已过期）。
- SDK 已有 `DelayedEventsManager`（6 个公开方法），本次把它的路径绑定到生成的
  `DelayedEventsPath` 上（编译期 segment 级断言），并从覆盖门禁的 WAIVED 表移除。
- **两套动作形态并存**（易错点）：`POST /delayed_events/{delay_id}` 带 body
  `{"action": ...}`，与 `POST /delayed_events/{delay_id}/{cancel|restart|send}`
  是**同一语义的两个端点**，后端均注册（`delayed_events.rs` 中相邻两行）。SDK
  统一走 body 形态（单请求、无 fallback），故 3 条 action-in-PATH 端点**有意不构造**。
- 该端点族是 `v1.4` 上游推荐形态之外的扩展面，后端还会拒绝 MSC4354 sticky 字段
  （501）——本服务把 sticky 建模为按用户置钉（`POST /rooms/{roomId}/sticky_events`）。

## 二、路由前缀与认证

- `/_matrix/client/unstable/org.matrix.msc4140/delayed_events`
- `/_matrix/client/unstable/org.matrix.msc4140/rooms/{room_id}/delayed_event/{event_type}/{txn_id}`
- 全部端点需要 `AuthenticatedUser`；`GET` 族按调用者过滤（只返回本人仍 pending 的事件）

## 三、核心请求与响应形状

延迟事件描述（`GET` 族返回值，SDK 侧 `DelayedEventInfo`）：

> `content` 按 **ADR-0005 / DTO-2** 写成 `IContent`（事件内容的唯一写法），而不是各模块
> 重复一份 `Record<string, unknown>`。SDK 侧既有的手写 `DelayedEventInfo.content` 仍为
> `Record<string, unknown>` —— 改用 `IContent` 属独立的公开 API 变更，未在本轮一并做。

```typescript
interface DelayedEventInfo {
    delay_id: number; // 后端 i64（JSON number）
    room_id: string;
    type: string;
    state_key?: string; // 缺席 = 消息事件，存在 = 状态事件
    delay_ms: number;
    delayed_since_ts: number;
    content: IContent;
}
```

列表响应（`raw.delayed_events ?? []`）：

```typescript
interface ListDelayedEventsResponse {
    delayed_events: DelayedEventInfo[];
}
```

管理动作请求体（body 形态；`UpdateDelayedEventAction` 三个取值）：

```typescript
interface UpdateDelayedEventRequest {
    action: "send" | "cancel" | "restart";
}
```

专用调度端点请求体（`PUT`；SDK 侧 `ScheduleDelayedEventRequest`）：

```typescript
interface ScheduleDelayedEventRequest {
    delay_ms: number; // 正整数，≤ 24h
    content: IContent; // 事件本体（不像 /send 那样整个 body 即内容）
    state_key?: string | null; // 缺席与显式 null 都表示消息事件
}
```

专用调度端点响应：

```typescript
interface ScheduleDelayedEventResponse {
    delay_id: number;
}
```

## 四、路由与 SDK 对齐表

| 方法 | 路径                                                                                              | SDK 方法                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| GET  | `/_matrix/client/unstable/org.matrix.msc4140/delayed_events`                                      | `listScheduledDelayedEvents()`                                                                     |
| GET  | `/_matrix/client/unstable/org.matrix.msc4140/delayed_events/{delay_id}`                           | `getScheduledDelayedEvent()`                                                                       |
| POST | `/_matrix/client/unstable/org.matrix.msc4140/delayed_events/{delay_id}`                           | `cancelScheduledDelayedEvent()` / `restartScheduledDelayedEvent()` / `sendScheduledDelayedEvent()` |
| POST | `/_matrix/client/unstable/org.matrix.msc4140/delayed_events/{delay_id}/cancel`                    | **有意不封装**（body 形态等价，单请求）                                                            |
| POST | `/_matrix/client/unstable/org.matrix.msc4140/delayed_events/{delay_id}/restart`                   | **有意不封装**（同上）                                                                             |
| POST | `/_matrix/client/unstable/org.matrix.msc4140/delayed_events/{delay_id}/send`                      | **有意不封装**（同上）                                                                             |
| PUT  | `/_matrix/client/unstable/org.matrix.msc4140/rooms/{room_id}/delayed_event/{event_type}/{txn_id}` | `scheduleDelayedEvent()`                                                                           |

## 五、SDK 对齐状态

- **总端点数**: 7
- **能力覆盖**: 100%（cancel/restart/send 经 body 形态端点提供，语义等价）
- **路径直接构造**: 4 / 7（其余 3 条 action-in-PATH 为**有意不封装**，见 §一）
- **路径绑定**: `src/delayed-events/index.ts` 使用生成的 `DelayedEventsPath` +
  `PathAssert<…, StripMsc4140<DelayedEventsPath>>`（segment 级精确断言，
  `/_matrix/client/unstable/org.matrix.msc4140` 前缀由 `StripMsc4140` 剥离）
- **运行时守卫**: 每个公开方法先 `assertSupported()`（探测服务端 MSC4140 支持），
  不支持时抛 `UnsupportedDelayedEventsEndpointError`，而不是发出必然 404 的请求
- **验证状态**: `spec/unit/delayed-events.spec.ts`

## 六、变更历史

| 日期       | 变更                                                                                                     | 影响                                 |
| ---------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 2026-10-15 | 新收编为 codegen 管辖模块：登记 alias + 章节映射 + `StripMsc4140`，manager 路径改编译期断言，解除 WAIVED | 7 条路由从「无约束」变为受契约表管辖 |
| 2026-10-14 | 后端补齐 `GET /delayed_events` 与 `PUT /rooms/…/delayed_event/…`；SDK 同步 2 → 7 条                      | 新增列表与专用调度能力               |
| 2026-04-27 | 初版（`delayed-events` 未独立成页，路由散落在 room 章节）                                                | -                                    |
