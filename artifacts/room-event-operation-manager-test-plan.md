# `room-event-operation-manager.ts` 测试方案（待 review）

> 状态：**方案，未实施**。目标文件 `src/room-summary/sub-managers/room-event-operation-manager.ts`（939 行 / 42 次 HTTP 调用）
> 台账编号：`coverage-critical-ledger.json` 条目 1（owner: langkebo, deadline: 2026-10-19）
> 起草日期：2026-10-05

## 1. 为什么要测这个文件

它是覆盖门禁扫出的 **21 条盲区里风险最高的一条**（42 次 HTTP 调用 / 0 个 spec 引用），
比历史报告点名的两个加密文件风险更高。属于房间事件读写主路径（通知、时间线、未读、元数据、
sticky events、摘要 CRUD），回归影响面大。

## 2. 动手前先报一个契约问题（**需要你决策，见 §8**）

读源码时发现该文件的契约绑定是**断裂**的，这会影响测试怎么写。

**事实**（可复验）：

| 检查项                                                                                                                   | 结果                                                     |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `src/room-summary/__generated__/route-table.ts` 条目数                                                                   | **21**                                                   |
| `src/room/__generated__/route-table.ts` 条目数                                                                           | **99**                                                   |
| `anti_screenshot` / `sticky_events` / `notifications` / `timeline` / `turn_server` / `rendered/` / `fragments/{user_id}` | 在 **room 表**里有，在 **room-summary 表**里**没有**     |
| 后端契约清册 `docs/api-contract/generated/route-manifest.all.json`                                                       | **1159** 条，上述路径**全部存在**，归属模块 = **`room`** |

复验命令：

```bash
grep -c 'method: "' src/room/__generated__/route-table.ts          # 99
grep -c 'method: "' src/room-summary/__generated__/route-table.ts  # 21
node scripts/audit/probe-route-module-attribution.mjs   # 逐条打印路径 -> 归属模块
```

**推论**：这些路由在契约里归 **`room` 模块**，但**实现在 `room-summary` 模块**。
`room-summary` 的表里没有它们 → `RoomSummaryPathPattern` 不含这些字面量
→ 代码**无法**用 `_rsv()` / `_rsi()` 断言（用了会编译失败）
→ 于是这 30+ 个方法改为把**普通 `string`** 传给 `requestV3(method: Method, path: string, ...)`。

也就是说，AGENTS.md 声称的「路径/方法是字面量类型，拼错是编译错误而不是运行时 404」
**在本文件范围内不成立**：只有 3 处（`summaryReadPath` / `internalSummaryPath` / `syncSummary`）
真正走了 `_rsv`/`_rsi` 断言，其余 ~39 处是裸字符串，**写错只会线上 404**。

这不是"代码写错"，而是**模块归属与实现位置错配**：契约把 room 级子资源划给了 `room` 模块，
而实现放在了 `room-summary/sub-managers/`。

## 3. 测试范围

### 3.1 要测（本 manager 自己的接线与语义）

- 42 个方法的 **HTTP 动词 / 路径 / 前缀 / query 拼装 / body 形状**
- 每个方法**自己的**参数校验分支（7 处 `InvalidParamError` + 3 处 validator 委托）
- 每个方法**自己的**字段归一化（4 处，见 §5 C 层）
- 每个方法**自己的**副作用回调（缓存失效 5 处 + 摘要缓存/事件 2 处）
- 路径参数编码（`encodeUri` / `encodeURIComponent`）
- 错误传播（4xx/5xx/网络）与 `normalizeError` 包装范围

### 3.2 **不测**（已由基类 spec 覆盖，避免重复造 4 个文件的工作）

`withRetry` 的重试次数/退避/幂等判定/统计计数、`normalizeError` 的内部分类逻辑，
已由以下既有 spec 覆盖，本文件**不重复**：

- `spec/unit/base-manager-retry.spec.ts`
- `spec/unit/base-manager-withretry.spec.ts`
- `spec/unit/base-manager-normalize.spec.ts`
- `spec/unit/base-manager-request.spec.ts`

本文件只在**方法级**断言"错误是否被归一化包装"（例如 `createOrRefreshSummary` 有 `try/catch + normalizeError`，
而 `getRoomCapabilities` 没有），不重新验证归一化算法本身。

## 4. Harness（复用本仓既有范式）

直接照 `spec/unit/room-summary/sub-managers/room-stats-manager.spec.ts` 的写法：

```ts
mockClient = { http: { authedRequest: vi.fn() } };
manager = new RoomSummaryEventOperationManager(
    mockClient,
    onCacheInvalidation,
    onError,
    summaryCache,
    onSummaryUpdated,
);
// 断言 5 参数形式（已由既有 spec 证实）：
expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
    "GET",
    "/rooms/!room%3Atest/capabilities",
    undefined,
    undefined,
    { prefix: "/_matrix/client/v3" },
);
```

关键事实：**`!room:test` 会被编码为 `!room%3Atest`**（`:` → `%3A`），
既有 spec 已锁定该行为，本文件沿用同一 fixture，避免两套 fixture 漂移。

`processSummaryUpdates` 的前缀是 `/_synapse/room_summary/v1`（内部 API），断言时单独区分。

## 5. 用例矩阵（6 层，约 85 例）

### A 层：契约接线（42 例，表驱动）——**核心**

每例断言 `(method, path, prefix)`；带 query/body 的方法同时断言后两者。
"归一化/副作用"列指向 C/D 层的额外用例。

| #   | 方法                      | 动词       | 路径（去 `/_matrix/client/v3`）                  | query                                      | body                                | 备注                         |
| --- | ------------------------- | ---------- | ------------------------------------------------ | ------------------------------------------ | ----------------------------------- | ---------------------------- |
| 1   | `getRoomNotifications`    | GET        | `/rooms/$roomId/notifications`                   | `from`,`limit`(String),`only`              | —                                   | C-1                          |
| 2   | `getRoomCapabilities`     | GET        | `/rooms/$roomId/capabilities`                    | —                                          | —                                   |                              |
| 3   | `getRoomSync`             | GET        | `/rooms/$roomId/sync`                            | `since`,`timeout_ms`(String),`filter`      | —                                   |                              |
| 4   | `getRoomAccountData`      | GET        | `/rooms/$roomId/account_data/$type`              | —                                          | —                                   | B                            |
| 5   | `setRoomAccountDataV3`    | **PUT**    | `/rooms/$roomId/account_data/$type`              | —                                          | `content`                           | B                            |
| 6   | `getRoomInvites`          | GET        | `/rooms/$roomId/invites`                         | —                                          | —                                   |                              |
| 7   | `getRoomReceipts`         | GET        | `/rooms/$roomId/receipts/$receiptType/$eventId`  | —                                          | —                                   | B×2                          |
| 8   | `getRoomTimeline`         | GET        | `/rooms/$roomId/timeline`                        | `from`,`to`,`dir`,`limit`(String),`filter` | —                                   |                              |
| 9   | `getRoomUnreadCount`      | GET        | `/rooms/$roomId/unread_count`                    | —                                          | —                                   | C-2                          |
| 10  | `getRoomMetadata`         | GET        | `/rooms/$roomId/metadata`                        | —                                          | —                                   | C-3                          |
| 11  | `getRoomVaultData`        | GET        | `/rooms/$roomId/vault_data`                      | —                                          | —                                   |                              |
| 12  | `setRoomVaultData`        | **PUT**    | `/rooms/$roomId/vault_data`                      | —                                          | `data`                              | D-1                          |
| 13  | `getRoomRetention`        | GET        | `/rooms/$roomId/retention`                       | —                                          | —                                   |                              |
| 14  | `getRoomExternalIds`      | GET        | `/rooms/$roomId/external_ids`                    | —                                          | —                                   |                              |
| 15  | `getRoomSpaces`           | GET        | `/rooms/$roomId/spaces`                          | —                                          | —                                   |                              |
| 16  | `getRoomEventPerspective` | GET        | `/rooms/$roomId/event_perspective`               | `room_version`,`event_id`                  | —                                   | 注意 `event_id` 走 query     |
| 17  | `getRoomPermissions`      | GET        | `/rooms/$roomId/permissions`                     | —                                          | —                                   |                              |
| 18  | `getRoomResolve`          | GET        | `/rooms/$roomId/resolve`                         | —                                          | —                                   |                              |
| 19  | `getRoomMessageQueue`     | GET        | `/rooms/$roomId/message_queue`                   | `from`,`limit`(String)                     | —                                   |                              |
| 20  | `getRoomServiceTypes`     | GET        | `/rooms/$roomId/service_types`                   | —                                          | —                                   |                              |
| 21  | `getRoomReducedEvents`    | GET        | `/rooms/$roomId/reduced_events`                  | —                                          | —                                   |                              |
| 22  | `getRoomRendered`         | GET        | `/rooms/$roomId/rendered/`                       | —                                          | —                                   | **尾斜杠**（契约已确认）     |
| 23  | `getRoomFragments`        | GET        | `/rooms/$roomId/fragments/$userId`               | —                                          | —                                   | B(validator)                 |
| 24  | `getRoomDevice`           | GET        | `/rooms/$roomId/device/$deviceId`                | —                                          | —                                   | B                            |
| 25  | `getRoomEventUrl`         | GET        | `/rooms/$roomId/event/$eventId/url`              | —                                          | —                                   | B                            |
| 26  | `translateRoomEvent`      | POST       | `/rooms/$roomId/translate/$eventId`              | —                                          | `body`（默认 `{}`）                 | B                            |
| 27  | `convertRoomEvent`        | POST       | `/rooms/$roomId/convert/$eventId`                | —                                          | `body`                              | B                            |
| 28  | `signRoomEvent`           | **PUT**    | `/rooms/$roomId/sign/$eventId`                   | —                                          | `body`                              | B                            |
| 29  | `verifyRoomEvent`         | POST       | `/rooms/$roomId/verify/$eventId`                 | —                                          | `body`                              | B                            |
| 30  | `getRoomTurnServer`       | GET        | `/rooms/$roomId/turn_server`                     | —                                          | —                                   |                              |
| 31  | `getAntiScreenshot`       | GET        | `/rooms/$roomId/anti_screenshot`                 | —                                          | —                                   | C-4                          |
| 32  | `setAntiScreenshot`       | **PUT**    | `/rooms/$roomId/anti_screenshot`                 | —                                          | `{enabled}`                         |                              |
| 33  | `getStickyEvents`         | GET        | `/rooms/$roomId/sticky_events`                   | —                                          | —                                   |                              |
| 34  | `setStickyEvent`          | POST       | `/rooms/$roomId/sticky_events`                   | —                                          | `{event_type,content}`              | B(validator)+D-2             |
| 35  | `deleteStickyEvent`       | **DELETE** | `/rooms/$roomId/sticky_events/$eventType`        | —                                          | —                                   | B(validator)+D-3             |
| 36  | `getRoomPowerLevels`      | GET        | `/rooms/$roomId/state/m.room.power_levels/`      | —                                          | —                                   | **尾斜杠**                   |
| 37  | `translate`               | POST       | `/translate`                                     | —                                          | `{content,source_lang,target_lang}` | B(`requireNonEmptyString`)   |
| 38  | `createOrRefreshSummary`  | POST       | `/rooms/$roomId/summary`                         | —                                          | `body`                              | D-4,E                        |
| 39  | `updateSummary`           | **PUT**    | `/rooms/$roomId/summary`                         | —                                          | `body`                              | D-5,E                        |
| 40  | `deleteSummary`           | **DELETE** | `/rooms/$roomId/summary`                         | —                                          | —                                   | D-6                          |
| 41  | `syncSummary`             | POST       | `/rooms/$roomId/summary/sync`                    | —                                          | `body`                              | 唯一走 `_rsv` 断言的方法之一 |
| 42  | `processSummaryUpdates`   | POST       | `/updates/process` @ `/_synapse/room_summary/v1` | —                                          | `body`                              | 内部前缀                     |

**A 层附加（约 12 例）**：

- A-q1~5：`notifications` / `sync` / `timeline` / `message_queue` / `event_perspective` 的 **options 全缺省**用例
  （断言 query 为 `{}` 或 `{ event_id }`，防止 `undefined` 被拼进 query）
- A-t1~3：`limit` / `limit` / `timeout_ms` **必须是 string**（`String()` 转换锁死；这是最易回归的一类）
- A-e1~4：路径编码 —— `roomId` 含 `:`/`/`、`eventType` 含 `/`、`userId` 含 `:`、`deviceId` 含特殊字符

### B 层：参数校验（10 例）

| 用例                                                                                                             | 期望                                                          |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `getRoomAccountData` 空 `type`                                                                                   | `InvalidParamError("type is required")`，**且不发请求**       |
| `setRoomAccountDataV3` 空 `type`                                                                                 | 同上                                                          |
| `getRoomReceipts` 空 `receiptType`                                                                               | `InvalidParamError("receiptType is required")`                |
| `getRoomReceipts` 空 `eventId`                                                                                   | `InvalidParamError("eventId is required")`                    |
| `getRoomDevice` 空 `deviceId`                                                                                    | `InvalidParamError("deviceId is required")`                   |
| `getRoomEventUrl` / `translateRoomEvent` / `convertRoomEvent` / `signRoomEvent` / `verifyRoomEvent` 空 `eventId` | 各自 `InvalidParamError`（5 方法合 1 参数化用例）             |
| `translate` 空 `content`                                                                                         | `requireNonEmptyString` 抛错                                  |
| `getRoomFragments` 非法 `userId`                                                                                 | validator 抛 `ValidationError`                                |
| `setStickyEvent` / `deleteStickyEvent` 非法 `eventType`                                                          | validator 抛 `ValidationError`                                |
| 全部 GET 方法传非法 `roomId`                                                                                     | validator 抛错（参数化：挑 3 个代表方法即可，不必 42 个都测） |

> **重要断言**：校验失败的用例必须同时断言 `authedRequest` **未被调用** —— 否则"先发请求后校验"的回归不会被发现。

### C 层：字段归一化（9 例）——**与本轮已修 bug 同类，最高价值**

| 用例                                                 | 断言                                                                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| C-1 `getRoomNotifications` 新字段                    | `type/timestamp/read/highlight` 直接透传                                                                       |
| C-1b 旧字段                                          | `notification_type/ts/is_read` 被映射；`highlight` 缺省为 `false`                                              |
| C-1c 分页                                            | `next_batch ?? next_token`                                                                                     |
| C-2 `getRoomUnreadCount`                             | `room_id ?? roomId`、`unread_notifications ?? notification_count`、`unread_highlight_count ?? highlight_count` |
| C-2b 旧字段                                          | 三个字段均取旧命名                                                                                             |
| C-3 `getRoomMetadata`                                | `created_at ?? created_ts`、`is_encrypted ?? Boolean(encryption)`                                              |
| C-3b `encryption` 为空对象                           | `is_encrypted` 为 `true`（`Boolean({})`）                                                                      |
| C-3c 显式 `is_encrypted: false` 且 `encryption` 存在 | 取显式值 `false`（`??` 不覆盖 `false`）                                                                        |
| C-4 `getAntiScreenshot`                              | `enabled ?? false`                                                                                             |

### D 层：副作用回调（7 例）

| 用例                              | 断言                                                                   |
| --------------------------------- | ---------------------------------------------------------------------- |
| D-1 `setRoomVaultData`            | `onCacheInvalidation(roomId)` 被调用                                   |
| D-2 `setStickyEvent`              | 同上，且返回后端结果                                                   |
| D-3 `deleteStickyEvent`           | 同上                                                                   |
| D-4 `createOrRefreshSummary` 成功 | `summaryCache.set` + `onSummaryUpdated` 均被调用                       |
| D-5 `updateSummary` 成功          | 同上                                                                   |
| D-5b `updateSummary` 返回空       | 走 `onCacheInvalidation` 分支，返回 `summaryCache.get(roomId) ?? null` |
| D-6 `deleteSummary`               | `onCacheInvalidation(roomId)`                                          |
| D-7 回调未注入（`undefined`）     | 上述方法**不抛错**（可选链保护）——防止把可选回调写成必填               |

### E 层：错误与重试边界（5 例）

- 4xx（`M_FORBIDDEN`）→ 原样抛出，**不重试**（由 base 保证，此处只验传播）
- 5xx → 由 `withRetry` 重试后仍失败则抛出；断言 `authedRequest` 被调用**多次**（>=2）
- 网络错误（`TypeError: fetch failed`）→ 传播
- `createOrRefreshSummary` 失败 → 抛 `normalizeError` 包装后的错误（与未包装方法对比）
- `updateSummary` 失败 → 同上

### F 层：契约守卫（1 例，**建议新增**）

表驱动断言：把 A 层 42 个方法实际发出的 `(prefix+path)` 归一化为 `{room_id}` 模板后，
**必须存在于 `docs/api-contract/generated/route-manifest.all.json`**。
价值：把"路径拼错"从"线上 404"变成"单测红"。这一层与本仓契约驱动理念一致，
也是 §2 那个断绑定问题的**守护网**。

## 6. 用例计数

| 层                        | 例数         |
| ------------------------- | ------------ |
| A 接线（42 主 + 12 附加） | 54           |
| B 参数校验                | 10           |
| C 归一化                  | 9            |
| D 回调                    | 8            |
| E 错误                    | 5            |
| F 契约守卫                | 1            |
| **合计**                  | **约 87 例** |

对比现状：该文件当前 **0 例**。

## 7. 执行与验收

1. 新建 `spec/unit/room-summary/sub-managers/room-event-operation-manager.spec.ts`
2. 验收：`npx vitest run <该 spec>` 全绿；`npx eslint <该 spec>` 干净；`prettier --check` 通过
3. `tsc --noEmit` 必须 `exit 0`
4. **变异自证**（证明测试真的会红，而不是"写了个绿测试"）：至少做 2 条
    - 把 `setRoomAccountDataV3` 的 `Method.Put` 改成 `Method.Post` → 必须有用例失败
    - 去掉 `getRoomNotifications` 的 `timestamp` 归一化 → 必须有用例失败
5. 通过后**从 `coverage-critical-ledger.json` 删除该条目**（否则门禁 R4 会失败 —— 这正是 R4 的设计目的）
6. 追加当日 memory 日志

## 8. 需要你决策的三件事

**① 契约归属问题怎么处理（阻塞项）**
`room` 模块的表里有这些路由，实现在 `room-summary` 里，导致字面量类型断言用不上。
三个选项：

- **A. 先测后修**：本轮只补测试（A~E 层），冻结当前行为；契约归属另开 issue。
  优点是本轮闭环、零架构改动风险；缺点是 F 层守卫只能对 manifest 而不能对模块表。
- **B. 先修归属再测**：改 `contract-module-map.mjs` 把相关路由划到 `room-summary`，
  re-codegen，然后把 39 处裸字符串改成 `_rsv()` 断言，再加 F 层。收益最大（恢复编译期保护），
  但会动 codegen 输出与 39 处调用点，需单独授权。
- **C. 只做 F 层守卫**：不改契约、不改调用点，只加"实际路径必须在 manifest 中存在"的单测。
  成本最低，能立刻防住新拼错。

**② 是否接受约 87 例的规模**（或先做 A 层 54 例 + C 层 9 例，B/D/E/F 放第二批）

**③ deadline 与 owner 是否需要调整**（当前 `langkebo` / 2026-10-19）

我的建议：**①选 A（本轮）+ C 层作为过渡守卫**，把 B 单独开成一张契约整改 ticket ——
因为 B 会改 codegen 输出与大量调用点，属于架构变更，不该混在"补测试"里。
