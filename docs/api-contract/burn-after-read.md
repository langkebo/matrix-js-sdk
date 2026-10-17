---
module: burn_after_read
generated_from: docs/api-contract/generated/modules/burn_after_read.json
generated_hash: sha256-97fff0bd19a4d2bdd6df5ef7a7198429f73d32a0ff83078963e34d66cb1cace3
ledger_schema: 4
last_reviewed: 2026-05-11
---

# Burn After Read API 契约文档

> 后端代码: `synapse-rust/synapse-web/src/routes/burn_after_read.rs`  
> 装配入口: `synapse-rust/synapse-web/src/routes/assembly.rs`  
> SDK 入口: `src/burn-after-read/index.ts`  
> 更新日期: 2026-05-11  
> 挂载版本: `v1`

## 一、当前审计结论

- `generated/modules/burn_after_read.json` 当前记录 **7** 条后端路由，不是旧文档中的 `6` 条。
- SDK 已有 `BurnAfterReadManager`，并已补上生成路由类型绑定，覆盖全部后端管理端点。
- 旧文档中的多个字段名已与后端实现不符:
    - `timeout_ms` 应为 `burn_after_ms`
    - `burn_at` 实际为 `created_at` / `delete_ts`
    - 用户配置不是 `default_enabled/default_timeout_ms`，而是 `default_burn_ms`
    - 统计响应包含 `total_pending` 和 `rooms_with_burn_enabled`
- `DELETE /_matrix/vendor/v1/rooms/{room_id}/burn/{event_id}` 真实存在，但旧文档遗漏了它在覆盖统计中的作用。

## 二、路由前缀与认证

- `/_matrix/vendor/v1/rooms/{room_id}/burn`
- `/_matrix/vendor/v1/user/burn/*`（实际为 `/_matrix/vendor/v1/user/burn/config` 与 `/stats`）
- 所有端点需要 `AuthenticatedUser`

## 三、核心请求与响应形状

```typescript
interface BurnSettings {
    enabled: boolean;
    burn_after_ms: number;
}
```

```typescript
interface PendingBurnEvent {
    event_id: string;
    created_at: number;
    delete_ts: number;
    is_processed: boolean;
    is_dead_letter: boolean;
}
```

```typescript
interface MarkBurnReadResponse {
    success: boolean;
    will_delete_at: number;
}
```

```typescript
interface CancelBurnResponse {
    success: boolean;
}
```

```typescript
interface SetBurnConfigResponse {
    default_burn_ms: number;
}
```

```typescript
interface BurnStats {
    total_burned: number;
    total_pending: number;
    rooms_with_burn_enabled: number;
}
```

补充说明:

- `PUT /rooms/{room_id}/burn` 请求体使用 `{ enabled, burn_after_ms }`。
- `GET /rooms/{room_id}/burn` 在后端未配置时返回默认值 `{ enabled: false, burn_after_ms: 60000 }`。
- `GET /rooms/{room_id}/burn/pending` 返回 `{ events }`，每项包含 `event_id`、`created_at`、`delete_ts`、`is_processed`、`is_dead_letter`。
- `POST /rooms/{room_id}/burn/{event_id}` 语义是“标记已读并触发延迟焚毁”，不是立即删除。
- `DELETE /rooms/{room_id}/burn/{event_id}` 用于取消待焚毁任务。
- `PUT /user/burn/config` 只接收并回传 `default_burn_ms`。
- `BurnAfterReadManager.sendMessage()` 与 `burnMessage()` 是客户端增强能力，不属于这 7 条后端契约路由统计。

## 四、路由与 SDK 对齐表

| 方法   | 路径                                                 | SDK 方法                         |
| ------ | ---------------------------------------------------- | -------------------------------- |
| GET    | `/_matrix/vendor/v1/rooms/{room_id}/burn`            | `getBurnSettings()`              |
| PUT    | `/_matrix/vendor/v1/rooms/{room_id}/burn`            | `enableBurn()` / `disableBurn()` |
| GET    | `/_matrix/vendor/v1/rooms/{room_id}/burn/pending`    | `getPendingBurns()`              |
| POST   | `/_matrix/vendor/v1/rooms/{room_id}/burn/{event_id}` | `markBurnRead()`                 |
| DELETE | `/_matrix/vendor/v1/rooms/{room_id}/burn/{event_id}` | `cancelBurn()`                   |
| PUT    | `/_matrix/vendor/v1/user/burn/config`                | `setBurnConfig()`                |
| GET    | `/_matrix/vendor/v1/user/burn/stats`                 | `getBurnStats()`                 |

## 五、SDK 对齐状态

- **总端点数**: 7
- **已封装**: 7
- **覆盖率**: 100%
- **路径绑定**: `src/burn-after-read/index.ts` 使用生成的 `BurnAfterReadPathPattern`
- **验证状态**: `spec/unit/burn-after-read.spec.ts`
- **额外客户端能力**: `sendMessage()`、`burnMessage()`、`extendBurnTime()`、本地缓存与定时器调度

## 六、变更历史

| 日期       | 变更                                                                     | 影响             |
| ---------- | ------------------------------------------------------------------------ | ---------------- |
| 2026-05-11 | 按后端真实 7 条路由重写字段、返回体与覆盖率口径，并补充 SDK 路径绑定说明 | 修复长期文档漂移 |
| 2026-04-27 | 初版                                                                     | -                |

## 实现口径补充（2026-10-17 后端契约回灌）

- `POST /rooms/{room_id}/burn/{event_id}` 只能由接收方发起：对 `sender` 为自己的事件操作返回 `403`；房间未启用阅后即焚返回 `400 M_BAD_JSON`；房间不存在返回 `404`；非房间成员返回 `403`。
- `PUT /rooms/{room_id}/burn` 的 `burn_after_ms` 缺省时按“请求值 → 用户默认值 → 服务端默认值”的顺序回退。
- `GET /rooms/{room_id}/burn` 在未配置时返回 `{ enabled: false, burn_after_ms: 60000 }`。
- 能力位 `io.hula.burn_after_read` 仅在认证后出现在 `/capabilities`。
- 用户级配置只有 `PUT /_matrix/vendor/v1/user/burn/config`，没有 GET 或 POST。
