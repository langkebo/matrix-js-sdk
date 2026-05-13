---
module: ephemeral
generated_from: docs/api-contract/generated/modules/ephemeral.json
generated_hash: sha256-0ba850cc826f06fd8604552e7ec550eb253ff5f9af785ec6882ce737bbfdfd8d
ledger_schema: 1
last_reviewed: 2026-05-11
---

# Ephemeral Events API 契约文档

> 后端代码: `synapse-rust/src/web/routes/ephemeral.rs`  
> 装配入口: `synapse-rust/src/web/routes/assembly.rs`  
> SDK 入口: `src/ephemeral/index.ts`  
> 更新日期: 2026-05-11  
> 挂载版本: `v3`

## 一、当前审计结论

- `generated/modules/ephemeral.json` 当前记录 **1** 条后端路由。
- SDK 已有 `EphemeralManager.getEphemeralEventsFromServer()`，本轮补上生成的 `EphemeralPathPattern` 路径绑定。
- 旧文档把响应体写成 `events[]`，但后端真实 JSON 键是 `chunk`。
- 后端单条临时事件还会返回 `origin_server_ts`、`stream_id` 和合成的 `event_id`，旧文档遗漏了这些字段。
- SDK 现在优先使用后端 `origin_server_ts` 作为事件时间戳，而不是本地 `Date.now()`。

## 二、路由前缀

- `/_matrix/client/v3/rooms/{room_id}/ephemeral`
- 需要 `AuthenticatedUser` + 房间成员权限

## 三、端点详情

### 3.1 查询房间临时事件

**路径**: `GET /_matrix/client/v3/rooms/{room_id}/ephemeral`  
**认证**: `AuthenticatedUser` + 房间成员  
**挂载版本**: `v3`

**响应**: `200 OK`

```typescript
interface EphemeralEventsResponse {
    chunk: Array<{
        type: string;
        sender: string;
        content: Record<string, unknown>;
        origin_server_ts: number;
        stream_id: number;
        event_id: string;
    }>;
    start?: string;
    end?: string;
}
```

补充说明:

- `event_id` 不是数据库原生字段，后端按 `$ephemeral_{stream_id}` 合成，供客户端去重。
- `limit` 查询参数默认值为 `100`。
- SDK `getEphemeralEventsFromServer()` 返回的是映射后的 `IEphemeralEventInfo[]`，其中 `timestamp` 取自 `origin_server_ts`。
- `getTypingEvents()`、`getReceiptEvents()`、缓存与清理方法属于在这 1 条后端契约之上的增强能力。

## 四、SDK 对齐状态

- **总端点数**: 1
- **已封装**: 1
- **覆盖率**: 100%
- **路径绑定**: `src/ephemeral/index.ts` 使用 `EphemeralPathPattern`
- **验证状态**: `spec/unit/ephemeral.spec.ts`

## 五、变更历史

| 日期       | 变更 | 影响 |
| ---------- | ---- | ---- |
| 2026-05-11 | 修正 `chunk` 返回体、事件字段、SDK 覆盖率与路径绑定说明，并同步时间戳语义 | 修复文档与实现漂移 |
| 2026-04-27 | 初版 | -    |
