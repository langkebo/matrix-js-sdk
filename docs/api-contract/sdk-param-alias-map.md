# SDK 参数名 ↔ 契约字段名 对照表

> **为什么需要这张表**：`synapse-rust/docs/sdk/*` 是**按后端字段名**写的契约（给所有客户端看），
> 而本 SDK 的公开参数名多按「语义」命名，两者在 5 处不一致 —— 功能正确（方法体内做了映射），
> 但**照契约写 SDK 代码会反复踩**。本表就是那层翻译。
>
> 来源：`artifacts/sdk-contract-audit-2026-10-17.md` §2.5（P3-01）。全部经双侧回源确认。

## 一、不一致清单

| #   | SDK 方法                                                                    | SDK 侧参数名                  | 线上字段名（契约）                  | 后端定义位置                                                         | 若不按契约发会怎样                                                                                                       |
| --- | --------------------------------------------------------------------------- | ----------------------------- | ----------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | `ThreadManager.searchThreads(roomId, params)`                               | `params.term`                 | **`q`**（必填）                     | `handlers/thread.rs` `SearchQuery.q`                                 | 后端读不到 `q` ⇒ 反序列化失败 **400**；`term` 被忽略                                                                     |
| 2   | `FriendRequestManager.addFriend(userId, opts)`                              | `opts.reason`                 | **`message`**                       | `friend_room.rs` `AddFriendRequest`（`deny_unknown_fields`）         | `reason` 是未知字段 ⇒ **400**                                                                                            |
| 3   | `RoomSummaryManager.batchGetSummaries(rooms, isSuggestedOnly)`              | 第二参数 `isSuggestedOnly`    | **`suggested_only`**                | `room_summary.rs` `RoomSummaryBatchRequest`（`deny_unknown_fields`） | `is_suggested_only` 是未知字段 ⇒ **400**（`fetchBatchSummaries` 同时接受 `is_suggested_only`/`suggested_only` 两种别名） |
| 4   | `ThreadManager.markThreadRead(roomId, threadId, readUpTo, originServerTs?)` | `readUpTo`                    | **`event_id`**                      | `handlers/thread.rs` `MarkReadBody.event_id`                         | 字段名对（内部已映射）；名字不同只影响可读性                                                                             |
| 5   | `ThreadManager.createThread(roomId, body)` / `createGlobalThread(body)`     | `body.event_id` + `body.name` | **`root_event_id`** + **`content`** | `handlers/thread.rs` `CreateThreadBody`                              | 名称已内部映射；⚠️ 另见下节                                                                                              |

## 二、必须知道的例外：`createThread` 的 `name` 是**静默无效**的

后端把 `content` 声明成 `_content`（`CreateThreadBody`，**下划线前缀 ⇒ Rust 侧不读取**），
仅用于"接受该键"。而 `content` 的类型是 `serde_json::Value`（任意 JSON 都合法），
所以传 `name` **既不报错、也不生效**。

```typescript
// ✗ 标题不会生效（也不会报错 —— 这就是最难发现的地方）
await client.getThreadManager().createThread(roomId, { event_id: "$root", name: "讨论" });

// ✓ 需要"标题"就在该线程内发一条消息承载
await client.roomManager.sendEvent(roomId, "m.room.message", { body: "讨论", msgtype: "m.text" });
```

SDK 侧已在 `createThread` / `createGlobalThread` 的 body 构造处加 `⚠️` 注释（2026-10-17）。

## 三、使用建议

1. **读 `docs/sdk/*` 写 SDK 代码时**，先查本表第 1–3 行（这三处不映射就是 400）。
2. 第 4–5 行只是命名差异，不影响功能；若你更习惯契约名，可在调用处加一行注释指明对应关系。
3. **不建议现在给 SDK 改名对齐契约** —— 属破坏性变更，且换不来功能收益；真要收敛，应在一个
   major 版本里连同 `CHANGELOG` 一起做。

## 四、为什么会出现这种分裂（供后续决策参考）

这些方法大多先于对应的后端端点落地（或先按 Matrix 语义命名），后端后定时用了自己的字段名；
当时的处置是**内部映射 + JSDoc 说明**（多处带「2026-10-09 实测」注记），避免破坏已发布的公开 API。
代价就是今天这张表 —— 一个可接受的折中，但需要一个**单一的、集中的**出处，而不是散在 5 个文件的注释里。
