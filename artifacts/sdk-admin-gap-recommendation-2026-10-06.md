# admin 面 25 条真缺口 —— 逐子域建议（2026-10-06）

> 上游结论：`artifacts/route-contract-encapsulation-report-2026-10-06.md` 的 admin 面 35 条，
> 经 `docs/sdk-encapsulation-audit.md` §13.15.6 复核 = **10 假阳性 + 25 真缺口**。
> 本文对这 25 条给出**可决策建议**（做 / 不做 / 条件做），并附落地批次与归位模块。
> **取证方式**：以 `docs/api-contract/generated/route-manifest.all.json`（= 后端 ledger 镜像，
> 1159 条，`mirrorMissing=0` / `mirrorExtra=0` 零漂移）为 ground truth，逐条对照后端 handler
> 实现（`synapse-web/src/routes/admin/*.rs`、`push_notification.rs`、`app_service.rs`）。

---

## 0. 结论摘要

| 处置               | 条数 | 说明                                                                       |
| ------------------ | ---- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **建议做**         | 17   | 分 A/B/C 三批落地（见 §3）                                                 |
| **不做**           | 3    | `media/delete`（高危 + 与已封 `purgeMediaCache` 语义重叠）、2 条单数旧别名 |
| **条件做（延后）** | 2    | `/media/{server_name}/{media_id}` 的 GET/DELETE（联邦媒体运维，按需）      |
| **最低优先**       | 1    | appservice 单 key state（已有无 key 变体，实为一行改动）                   |
| **不是缺口**       | 2    | `media/quarantine                                                          | unquarantine/{server}/{id}` 已被上轮缺陷修复真实消费（模板字面量，静态检测不可见） |

> 25 = 17 建议做 + 3 不做 + 2 延后 + 1 最低优先 + 2 已消费。

**另需注意**：本轮取证时发现 admin 侧另有一簇**性质不同的缺陷**（不是「未封装」，而是
「打了后端未注册的路径」），共 6 处必 404 + 5 处死 fallback + 3 处预置未实现，详见 §4。
它与本文的 25 条互不重叠，**建议单独立项**。

---

## 1. 判定口径（沿用四问，并新增两条 admin 专属判据）

四问同前（G1 无别名 / G2 无替代 / G3 客户端面 / G4 有产品价值），本次追加：

| 追加判据          | 含义                                   | 为什么需要                                                        |
| ----------------- | -------------------------------------- | ----------------------------------------------------------------- |
| **G5 风险可控**   | 操作是否**不可逆**、是否会造成数据丢失 | admin 面与 client 面最大区别：`delete`/`purge` 类操作**没有撤销** |
| **G6 语义不重复** | 后端是否已有**等价能力**被本 SDK 封装  | 避免为「同一种删除」提供两个入口，让调用方选错                    |

**G5 或 G6 不成立的，一律不给「建议做」**——这是本文与「照单全收」的关键差异（见 §2.1 的 `media/delete`）。

---

## 2. 逐子域建议

### 2.1 `admin/media.rs`（16 条 → 建议做 9 / 延后 2 / 不做 3 / 已消费 2）

| #   | 端点                                                | 后端 handler（取证）                                                                                  | 语义与价值                                                                                                                              | 建议                    |
| --- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 1   | `GET /rooms/{room_id}/media`                        | `get_room_media`（`limit` 1..500、`from` 游标）                                                       | 「房间媒体」列表：审核面板查看某房间全部媒体——**IM 应用最常用的媒体运维入口**                                                           | ✅ **做**               |
| 2   | `POST /rooms/{room_id}/media/quarantine`            | `quarantine_room_media`（body 可带 `user_id` 只隔离该用户的媒体）                                     | 房间维度批量隔离：涉黄/涉政内容处置                                                                                                     | ✅ **做**               |
| 3   | `POST /rooms/{room_id}/media/unquarantine`          | `unquarantine_room_media`（同上支持 `user_id`）                                                       | 上面动作的回退（误操作补救）                                                                                                            | ✅ **做**               |
| 4   | `DELETE /rooms/{room_id}/media/{media_id}`          | `delete_room_media`                                                                                   | 删除房间内指定媒体；**不可逆** → 调用方需二次确认                                                                                       | ✅ **做**（标注不可逆） |
| 5   | `POST /user/{user_id}/media/quarantine`             | `quarantine_user_media`（无 body，纯 path）                                                           | 用户维度隔离：处置「同一用户在多房间散布违规媒体」                                                                                      | ✅ **做**               |
| 6   | `GET /media/quarantine_changes`                     | `get_global_media_quarantine_changes`（`from` + `limit=100`，返回 `origin`/`media_id`/`quarantined`） | 全局隔离**增量流**：与既有 `getMediaQuarantineChanges`（按 media_id 查单条）互补，可做本地镜像同步                                      | ✅ **做**               |
| 7   | `POST /media/protect/{media_id}`                    | `protect_media_by_id`（用 `ctx.server_name`，本地媒体）                                               | 媒体保护（防被隔离/清理）——对家规「白名单媒体」有用                                                                                     | ✅ **做**               |
| 8   | `POST /media/protect/{server_name}/{media_id}`      | `protect_media`（显式 server）                                                                        | 同上，联邦媒体形态                                                                                                                      | ✅ **做**               |
| 9   | `POST /media/unprotect/{media_id}`                  | `unprotect_media_by_id`                                                                               | 上面动作的回退                                                                                                                          | ✅ **做**               |
| 10  | `GET /media/{server_name}/{media_id}`               | 联邦媒体详情                                                                                          | 与既有 `getMediaInfo`（本地形态）并存；**仅在有联邦媒体运维需求时才有价值**                                                             | ⚠️ **延后**             |
| 11  | `DELETE /media/{server_name}/{media_id}`            | 联邦媒体删除                                                                                          | 同上；且不可逆                                                                                                                          | ⚠️ **延后**             |
| 12  | `POST /media/delete`                                | `delete_media_by_policy`（`before_ts` / `max_size`，0 = 不限）                                        | 批量删本地媒体回收磁盘——**高危**，且后端 `purge_media_cache` 在本实现已退化为「按策略删本地媒体」（handler 注释明写），**已有等价入口** | ❌ **不做**             |
| 13  | `GET /room/{room_id}/media`                         | `get_room_media`（**同一 handler**）                                                                  | `/room/` 单数形态是 `/rooms/` 的**旧别名**（后端两者同 handler）                                                                        | ❌ **不做**             |
| 14  | `POST /room/{room_id}/media/quarantine`             | `quarantine_room_media`（**同一 handler**）                                                           | 同上，旧别名                                                                                                                            | ❌ **不做**             |
| 15  | `POST /media/quarantine/{server_name}/{media_id}`   | `quarantine_media`                                                                                    | **已被上轮修复消费**（`AdminMediaManager.quarantineMedia(serverName, mediaId)` 走模板字面量）                                           | ✅ 已消费（非缺口）     |
| 16  | `POST /media/unquarantine/{server_name}/{media_id}` | `unquarantine_media`                                                                                  | **已被上轮修复消费**（同上）                                                                                                            | ✅ 已消费（非缺口）     |

**归位**：全部落在已有的 `src/admin/sub-managers/admin-media-manager.ts`（该 manager 已承担
`getMedia` / `getMediaInfo` / `deleteMedia` / `getMediaQuota` / `purgeMediaCache` /
`getMediaQuarantineChanges` / `getUserMedia` / `deleteUserMedia`），新增按 **room / user / quarantine 三小节**组织。

> **关于 #12 的两点说明（这是本子域唯一有争议的一条）**
>
> 1. **G5 不成立**：`delete_media_by_policy` 会真删媒体文件且**无撤销**；参数 `0 = 不限` 意味着
>    一次误调用可能清空全站本地媒体。客户端管理面板暴露它的收益（省磁盘）远小于风险。
> 2. **G6 不成立**：后端 `purge_media_cache` 的 handler 注释写明——「本实现只有本地媒体，
>    故退化为删除符合访问时间策略的本地媒体」。也就是说 `purgeMediaCache(beforeTs)`
>    **已经是**「按时间批量删本地媒体」，再补 `media/delete` 等于给同一能力开第二入口。
>    → 结论：**不新增**，若确有磁盘回收需求，优先完善既有 `purgeMediaCache` 的文档与确认交互。

---

### 2.2 `push_notification.rs`（4 条 → 建议做 4）

| #   | 端点                 | 后端 handler（取证）                                                                                           | 语义与价值                                       | 建议      |
| --- | -------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------- |
| 17  | `POST /push/cleanup` | `cleanup_logs`（`days` 1..200，默认 30）                                                                       | 清理推送历史日志：自助运维常见动作               | ✅ **做** |
| 18  | `GET /push/config`   | `get_push_config`（返回 `config` + `initialized_providers` + `supported_keys`；**密钥已做掩码**，只留后 4 位） | 查看推送渠道凭据状态（FCM/APNs 等）              | ✅ **做** |
| 19  | `PUT /push/config`   | `put_push_config`（`{config: {k: v}}`，`null` = 删除该键；**改动立即生效、无需重启**）                         | 运维在面板上配置推送凭据，不必重启 homeserver    | ✅ **做** |
| 20  | `POST /push/process` | `process_queue`（`batch_size` 1..500，默认 100）                                                               | 手动触发推送队列处理：排障「推送积压」的必备手段 | ✅ **做** |

**归位**：**新建 `src/admin/sub-managers/admin-push-manager.ts`**，而不是塞进既有 manager。

理由（职责分明）：

- `admin-notification-manager.ts` 现有内容全是 **`/server_notices` 服务器公告**（list/get/create/update/delete/deactivate），
  与「**推送队列运维**」是两件事，混在一起会让「通知」一词在本模块内出现两种含义。
- `admin-config-manager.ts` 承担的是**服务端配置项**，而 `push/config` 是**推送凭据**（含密钥掩码逻辑）。
- 该 4 条恰好构成一个完整闭环：**看凭据 → 改凭据 → 看积压 → 清积压**，独立成 manager 最清晰。

**附带收益**：`src/notifications/__generated__/route-table.ts` 里的这 4 条 admin 路由
目前**有表无人消费**（见 §5 门禁局限），补齐后从「幽灵路由」变为真实消费。

---

### 2.3 `admin/server.rs`（2 条 → 建议做 2）

| #   | 端点                     | 后端 handler（取证）                                                                                                                                                                                                           | 语义与价值                                     | 建议      |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | --------- |
| 21  | `GET /server`            | `get_admin_info_compat` → `get_admin_info`：返回 `{server_name, server_version, implementation}`，**仅 `super_admin` 可访问**（否则 403）                                                                                      | 服务器身份/版本；且见下方「顺带修缺陷」        | ✅ **做** |
| 22  | `GET /rate-limit-status` | `get_rate_limit_status`：返回 `enabled` / `backend` / `redis_available` / `active_rules` / `exempt_paths` + 一套计数（`requests_total`/`rejected_total`/`allowed_total`/`exempt_total`/`fail_open_total`/`fail_closed_total`） | 限流可观测性：管理面板可直接画「拒绝率」等指标 | ✅ **做** |

**归位**：`src/admin/sub-managers/admin-server-manager.ts`（已有 `getServerInfo`/`getServerStats`/`getServerStatus`/`getServerHealth`/`getServerVersion` 等）。

> **顺带修缺陷（强烈建议同批做）**：`GET /server` 正好是 §4-A 中
> `AdminServerManager.getAdminInfo()` / `getServerInfo()` 路径错的**正解**——
> 二者现在打的 `/_synapse/admin/v1/info` 未注册（后端是**不带 v1** 的 `/_synapse/admin/info`）。
> 把主路径改到同前缀的 `/server`，是**最小改动且不需要改 prefix 机制**。
> 唯一注意：`/server` 限 `super_admin`，普通 `admin` 会 403——需在 JSDoc 中写明，并保留降级。

---

### 2.4 `admin/room/mod.rs`（2 条 → 建议做 2）

| #   | 端点                                   | 后端 handler（取证）                                                                                                                                                                                     | 语义与价值                                                                             | 建议                    |
| --- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------- |
| 23  | `POST /rooms/{room_id}/cascade_redact` | `cascade_redact_event`：body `event_id`**必填** + `reason` 可选；递归撤回关联事件（`m.replace` / `m.relates_to` / `m.in_reply_to`）；**不落 `m.room.redaction`**，以 `admin.cascade_redact` 审计日志归属 | **审核刚需**：普通撤回只打一条消息，而「改帖/引用/表情回应」会残留；级联撤回一次清干净 | ✅ **做（优先级最高）** |
| 24  | `POST /rooms/{room_id}/backfill`       | `backfill_room`：body `limit` 可选；返回 `{source_server, persisted_events, candidates_tried}`；房间不存在 404                                                                                           | 联邦历史回填（修复「缺事件/断链」）                                                    | ✅ **做**               |

**归位**：`src/admin/sub-managers/admin-room-manager.ts`。

> **注意与既有的区别**：该 manager 已有 `redactRoomEvents(roomId, payload)`，但它打的是
> **`POST /_matrix/client/v3/admin/room/{roomId}/redact`**（fork 私有路径，按时间/条数批量撤回），
> 与 `cascade_redact`（按 **event_id 及其关系链**递归撤回）**语义不同、端点不同**，二者互补而非重复。
> 建议在两者的 JSDoc 里互相交叉引用，避免调用方混淆——这正是「职责分明」在该文件上的具体体现。

---

### 2.5 `app_service.rs`（1 条 → 最低优先，建议暂不做）

| #   | 端点                                         | 后端 handler（取证）                                        | 语义与价值                                                                                 | 建议                          |
| --- | -------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------- |
| 25  | `GET /appservices/{as_id}/state/{state_key}` | `get_app_service_state(as_id, state_key)` 返回单条 state 项 | SDK 已有 `GET /appservices/{as_id}/state`（**无 key，返回全部**）；单 key 变体只是便捷重载 | ❌ **暂不做**（或加可选参数） |

> **理由**：能力已被覆盖（拿到全部再取一个键，是纯客户端操作），而 appservice 管理在本客户端
> 并非核心场景。**若以后确有需要，正确做法是给既有方法加一个可选 `stateKey` 参数**，
> 而不是新增一个平行方法——避免两个仅在路径末尾不同的公开 API。

---

## 3. 落地批次建议

| 批次  | 主题                    | 内容                                                                                                          | 模块                                               | 批次价值                                       |
| ----- | ----------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------- |
| **A** | 审核 / 媒体运维（P1）   | §2.1 的 #1–#4（房间媒体查看/隔离/取消隔离/删除）+ #5（用户媒体隔离）+ #6（全局隔离增量）+ #7–#9（保护三件套） | `admin-media-manager.ts`（新增 3 小节）            | 一次性把「媒体处置」做完整，审核面板可直接落地 |
| **B** | 审核刚需 + 可观测（P1） | `cascade_redact`（#23）、`backfill`（#24）、`GET /server`（#21）、`GET /rate-limit-status`（#22）             | `admin-room-manager.ts`、`admin-server-manager.ts` | 级联撤回是审核缺口；限流视图补上运维盲区       |
| **C** | 推送运维（P2）          | #17–#20                                                                                                       | **新建** `admin-push-manager.ts`                   | 关闭「有表无人消费」，推送排障闭环             |

**若只做一批**：建议 **B**（`cascade_redact` 是最明确的审核能力缺口，且同批可顺手修掉 `/info` 缺陷）。

**每条新方法的验收标准**（与 B1–B4 一致）：

- `tsc --noEmit` 0 错；`prettier` / `eslint`（`src spec`）通过；
- JSDoc 写明**对应后端 handler + 权限要求 + 是否不可逆**；
- 入参校验（空 id、非法 `days`/`batch_size`/`limit` 范围）；
- 每个方法至少 1 条单测，断言**真实 HTTP 方法 + 完整路径 + prefix**（防「路径写错」回归）。

---

## 4. 附带发现：admin 侧「路径对账」缺陷簇（性质不同，建议单独立项）

取证方式：抽取 `src/**` 中 `adminRequest(Method.X, "<字面量>")` 的调用点（**92 处**），
逐条加 `AdminPrefix.V1` 前缀后与后端注册面求差。
（**下界声明**：仅覆盖「方法名 + 逗号 + 字面量」的写法，多行调用与嵌套泛型未纳入，实际数量可能更多。）

### 4.1 A 类：必然 404 的真错（6 处）

| #   | SDK 方法                                               | 现在打的路径                        | 后端实际注册                                                                                | 证据                                                     |
| --- | ------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | `AdminServerManager.getAdminInfo()`                    | `GET /_synapse/admin/v1/info`       | `GET /_synapse/admin/info`（**无 v1 段**）或 `GET /_synapse/admin/v1/server`                | `admin/mod.rs:76`、`admin/server.rs:16`                  |
| 2   | `AdminServerManager.getServerInfo()`                   | `/info`（主）+ `/server_info`（备） | 同上——**两条都未注册**                                                                      | 同上                                                     |
| 3   | `AdminServerManager.cleanupDatabase()`                 | `POST /cleanup`                     | `POST /cleanup/all` \| `/cleanup/rooms` \| `/cleanup/tokens`                                | 后端 derived route table                                 |
| 4   | `AdminServerManager.sendServerNotice()`（字符串分支）  | `POST /server_notices`              | `POST /send_server_notice`（**同方法的对象分支已在用正解**）                                | manifest 有 `POST /_synapse/admin/v1/send_server_notice` |
| 5   | `AdminFederationManager.addFederationBlacklistEntry()` | `POST /federation/blacklist`        | `POST /federation/blacklist/{server_name}`                                                  | 后端只注册带 `server_name` 段的形态                      |
| 6   | `AdminNotificationManager.deactivate()`                | `DELETE /notifications/deactivate`  | `PUT /notifications/{notification_id}/deactivate`（**方法也不同**，且语义是「按 id 停用」） | 后端无 `/notifications/deactivate`                       |

### 4.2 B 类：死 fallback（5 处，主路径正确，fallback 永不命中）

`getServerStats`→`/server_stats`（`:87`）、`getServerHealth`→`/server_health`（`:126`）、
`getServerConfig`→`/server_config`（`:358`）、`getFederationAdmissions`→`/federation/admissions`（`:251`）、
`getPendingFederationServers`→`/federation/pending_servers`（`:275`）。

> 无害但**有误导性**：读者会以为后端存在这两个名字的端点。建议清理或改为注释说明。

### 4.3 C 类：预置但后端未实现（3 处，属「超前实现」而非「错」）

`/backups`（`admin-server-manager.ts:446`）、`/presence_routes`（`admin-config-manager.ts:362/366`）、
`/rate_limit_callbacks`（`admin-config-manager.ts:386/390`）。

> 与 A/B 区别：后端**根本没有这个能力**，不是路径写错。是否保留取决于产品意图（预置待后端补齐 vs 直接删除）。建议在 JSDoc 标注「后端尚未实现」。

### 4.4 为什么这批缺陷能长期存活（一）：**测试把错误路径固化了**

| 测试                                                                                | 断言                                         |
| ----------------------------------------------------------------------------------- | -------------------------------------------- |
| `spec/unit/admin-new-endpoints.spec.ts:436/444`                                     | `expect(req.mock.calls[0][1]).toBe("/info")` |
| `spec/unit/admin/sub-managers/admin-notification-manager.spec.ts:140/147`           | `"DELETE" , "/notifications/deactivate"`     |
| `spec/unit/federation.spec.ts:34` / `spec/unit/api-encapsulation-audit.spec.ts:199` | `"GET", "/federation/blacklist"`             |

这些用例是「**字面量 vs 字面量**」断言，只能证明「代码没变」，**证明不了「后端认这个路径」**。

### 4.5 为什么这批缺陷能长期存活（二）：**既有门禁对 `adminRequest` 简写形态存在抽取盲区**

项目**已经有**专门的门禁：`quality:path-contract` → `scripts/quality/verify-path-contract.mjs`。
它的设计目的与本文 §4 完全一致——文件头注释写明它诞生于 **2026-09-30 联调发现的
appservice 路径缺陷**（`/application_services` 下划线 vs 后端 `appservices`），并明确
「该缺陷在 35/35 单测全绿的情况下完全不可见 —— 因为 mock 层不校验真实路径」。

**但它抓不到这 6 处**，原因在抽取层：它只有两个抽取器——

| 抽取器                   | 位置                           | 认得的写法                                                                                                    |
| ------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `extractObjectCalls`     | `verify-path-contract.mjs:183` | 对象形态：`{ method: Method.X, path: "...", prefix: ... }`（正则 `\bmethod:\s*Method\.(\w+)`）                |
| `extractPositionalCalls` | `verify-path-contract.mjs:226` | 位置形态：**正则字面量只含 `authedRequest`** —— `/\bauthedRequest<[^>]*>\(\s*Method\.(\w+)\s*,\s*("…"\|`…`)/` |

而 `src/admin/**` 的主力写法是 **`this.adminRequest(Method.X, "/path")`**——**两个抽取器都不认**。
实测规模：`adminRequest(` 163 处 + `adminRequest<` 118 处 = **281 处调用点**（其中字面量路径 92+ 处）。

**实测门禁输出**（本次已运行）：

```
扫描源文件   : 460
提取请求调用 : 159      ← 只提取到 159 个，admin 面一个都没进来
匹配成功     : 155
已豁免       : 4
不匹配       : 0
✅ 全部静态请求路径均与后端 ledger 一致（豁免 4 处已登记）。
```

→ 那句「**全部**静态请求路径均与后端 ledger 一致」是对**159 个调用点**下的结论，
而 admin 面的字面量路径**从未进入校验**。结论不是「没有门禁」，而是
**「门禁有洞，且洞的形状恰好等于 admin 面的写法」**——这正是 6 处必 404 缺陷能长期存活的结构性原因。

**建议顺序：先补门禁 → 再修路径**（否则修完还会再长出来）

1. 把 `extractPositionalCalls` 的被调方从 `authedRequest` 扩展到 **`adminRequest`**；
   注意 `adminRequest<{ a: string }>(...)` 这类泛型里含 `{}`，现用的 `[^>]*` 会提前截断，需改成配平扫描。
2. **重跑门禁并确认 6 处 A 类缺陷变红**——这一步同时是门禁的**变异自证**（改前红 / 确认命中 / 再修），
   避免「补了抽取器但其实没生效」这种新的纸面门禁。
3. 再修 §4.1 的 6 处 A 类缺陷；B 类死 fallback 顺手清理。
4. **顺手处理一条失效豁免**：门禁当前 **`EXIT=1`**，原因不是路径不匹配，而是
   「**未被引用的豁免**」`DELETE /_matrix/client/v3/voice/{X}`（后端已补齐该端点，见
   `path-contract-waivers.json`）。这是记账问题，但它会让 `quality:contracts` 聚合门禁保持红色——
   按豁免表自己的规则（「后端补齐后忘记删豁免，会让门禁的失败面被旧条目遮住」），应删除该条目。

---

## 5. 三条工具/门禁局限（本轮再次被证实）

1. **静态检测看不见「模板字面量路径」**：`AdminMediaManager.quarantineMedia` 上轮已改为
   `` `/media/quarantine/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}` ``，
   运行时可正确命中，但对账工具仍把它计入「未封装」（本次 25 条中的 2 条即由此而来）。
   → 结论：**未封装清单既会漏（假阴性），也会多（假阳性）**，必须回源码核验。
2. **`quality:path-contract` 抽取不到 `adminRequest` 简写形态**（详见 §4.5）：它只认对象形态与
   `authedRequest<T>(...)`，于是 admin 面 281 处调用点整体落在校验之外，门禁仍打印「全部一致」。
3. **`check-manager-codegen-coverage.mjs` 的粒度是「模块」而非「路由」**：`push_notification`
   的 4 条 admin 路由就在 `src/notifications/__generated__/route-table.ts` 内，B1 打通该表消费后
   门禁即显示 `covered`——但这 4 条**当时并无任何方法调用**。它能防「有表没人读」，
   防不了「表里有幽灵路由」；批 C 落地后这一处才真正闭合。

> 三条局限的共同形状是：**「门禁/检测的覆盖面 ≠ 它以完成时态宣称的覆盖面」**。
> 因此对任何「已通过」的结论，都应追问一句：它到底覆盖了多少、漏了哪一类写法。

---

## 6. 待你决策

按 §3 建议，可执行的选项：

1. **先补门禁盲区**（§4.5 步骤 1–2，含变异自证）+ 修 §4.1 的 6 处 A 类缺陷——**这是最短路径**，
   因为门禁补上后能立刻证明缺陷真实存在，「修完不再长出来」也有保障；
2. **只做批 B**（`cascade_redact` + `backfill` + `GET /server` + `GET /rate-limit-status`）；
3. **批 A + B**（媒体运维 9 条 + 审核/可观测 4 条）；
4. **A + B + C 全做**（17 条，含新建 `admin-push-manager.ts`）；
5. **本轮不实现**，仅把本文归档为决策依据。

§4 的缺陷簇（6 真错 + 5 死 fallback + 3 预置未实现）建议**独立成批**处理，
不要与本轮的「补能力」混在同一次提交里——两者性质不同（一个是「加」，一个是「修」）。

---

**生成方式**：`docs/api-contract/generated/route-manifest.all.json` 全量比对 + 后端 handler 源码逐条阅读（`synapse-web/src/routes/admin/media.rs`、`admin/server.rs`、`admin/room/mod.rs`、`push_notification.rs`、`app_service.rs`）+ SDK 调用点脚本抽取（`adminRequest` 字面量 92 处）+ 实测运行 `scripts/quality/verify-path-contract.mjs` + 测试断言取证。
