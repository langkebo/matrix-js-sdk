# SDK ↔ 后端契约一致性审查（2026-10-17）

> **审查对象**：`/Users/ljf/Desktop/hu_ts/matrix-js-sdk`（`@langkebo/matrix-js-sdk@40.2.0-langkebo.6`，HEAD `72a6c9b29` 之上）
> **契约依据**：`synapse-rust/docs/synapse-rust/ROUTE_CONTRACT.md`（1602 行，HEAD `2946e19eb`）+ `synapse-rust/docs/sdk/*`（17 篇 / 7530 行）
> **后端事实源**：`synapse-web/src/routes/**` handler 源码
> **本次为只读审查，未修改任何代码。**

## 0. 范围、方法与口径

### 0.1 方法：三级证据（不采信单侧陈述）

| 级别 | 证据                                                                       | 强度                | 本次用途         |
| ---- | -------------------------------------------------------------------------- | ------------------- | ---------------- |
| L1   | SDK `src/**/__generated__/route-table.ts` 声明                             | 弱（只代表"约定"）  | 覆盖分母         |
| L2   | Manager 中的**真实调用点**（`request({path, method, body, queryParams})`） | **最强**            | 判「是否已封装」 |
| L3   | 路径构造器字面量                                                           | 弱（不校验 method） | 辅助             |

对每条判断，均回源**双侧**：SDK 的方法体实际发出什么 ↔ 后端 handler 的提取器实际要求什么。**不采信附录、不采信既有审计结论**（本轮据此纠正了 2 处既往误报，见 §2.4）。

### 0.2 端点口径（三套计数已对齐，但 SDK 镜像落后）

| 口径                  |                        值 | 来源                                          | 状态               |
| --------------------- | ------------------------: | --------------------------------------------- | ------------------ |
| SDK lane `default`    |                  **1019** | `fixtures/ledger_export_sdk/default.json`     | ✅ 与 README 一致  |
| SDK lane `all`        | **1038**（distinct 1033） | 同上 `all.json`                               | ✅                 |
| golden lane `default` |                   **959** | `docs/openapi/route-table.json::total_routes` | ✅ 与 README 一致  |
| live 生成表 `always`  |                  **1019** | `derived_route_table_always.inc.rs`           | ✅ 与 fixture 一致 |
| **SDK 契约镜像**      |    **1017 / 1036 / 1028** | `docs/api-contract/generated/` @ `c7c9116db`  | ❌ **落后 2 条**   |

### 0.3 覆盖面（复用仓内既有权威工具，非自造指标）

`node scripts/audit/compare-routes.mjs --output <临时路径>`（10-17 实测）：

| 指标                               | 值                    |
| ---------------------------------- | --------------------- |
| 声明面覆盖（T3，全后端）           | **95.2%**（983/1033） |
| **客户端面真缺口（三级证据全无）** | **0**                 |
| 客户端面实现证据                   | **589 / 641 = 91.9%** |
| 版本/前缀漂移                      | **0**                 |
| T1 调用点 / T2 构造 / T3 仅声明    | 118 / 810 / 79        |
| 非产品面缺口（不应封装）           | 30                    |

## 1. 结论速览

1. **旧账基本清了**：`ROUTE_CONTRACT.md` 附录 B 的 27 条（19 P1 + 8 P2）经逐条回源，**26 条已修**，唯一未做的是 G-01（app_service 通配代理，附录 B 自述"是否需封装待定"）。→ §3
2. **覆盖面达标**：客户端面**真缺口 0**、实现证据 91.9%、漂移 0。缺的 30 条集中在 federation/admin 内部等服务端面，**不应**由客户端 SDK 承担。
3. **新问题集中在三类**：①**契约镜像落后 2 条**（对账机制失真）；②**参数静默无效/语义可疑**（4 处，门禁抓不到）；③**契约文档互相矛盾 + 计数过期**（3 处，会误导后续审计）。

## 2. 问题清单

> 严重度口径沿用附录 B：**P1** = 功能不可用或静默返回错误结果；**P2** = 边缘场景 / 静默降级 / 非主链路；**P3** = 代码与文档卫生。

### 2.1 P1-01 契约镜像落后后端 2 条，使「对账」建立在错基线上

- **严重度**：P1（机制级：所有后续覆盖判断都会缺这 2 条）
- **涉及**：`docs/api-contract/generated/**`、`src/*/__generated__/route-table.ts`（`app_service` 面）
- **判断依据**：
    - `node scripts/contract-sync.mjs --check --source=../synapse-rust/tests/unit/fixtures/ledger_export_sdk` →
      `app_service (+2 ~0 -0)`：
      `+ POST /_matrix/client/v1/appservice/fed_proxy`、
      `+ POST /_matrix/client/unstable/io.element.msc4512/appservice/fed_proxy`（`registered_by: app_service`）
    - `compare-routes.mjs` 独立确认：`SDK 镜像底座: 1036 条 @ c7c9116d → 落后 2 / 多出 0`
    - 后端已前进到 `2946e19eb`，fixture 为 1019/1038/1030
- **影响**：① `wire-format` / `route-set-parity` / 缺口报告都以镜像为底座 ⇒ 这 2 条**永不出现在任何门禁视野**；② 更隐蔽的是 **`contract-sync --check` 不带 `--source` 时默认 source 是仓内 `generated/` 自身**（`DEFAULT_CHECK_SOURCE_DIR = GENERATED_DIR`），它只做「仓内自洽」，**永远报 `in sync`** —— 用它判断"是否跟随后端"必然误判（本项目已因此误判过一次）。
- **修复建议**：按自底向上顺序执行（详见 §4 P0），一次提交完成；并在 CI 里**只允许**带 `--source` 的判据。

### 2.2 P2-01 `createThread` / `createGlobalThread` 的 `name` 参数**静默无效**

- **严重度**：P2（不报错、不 400，但用户传入的标题被丢弃）
- **涉及**：`src/thread/index.ts:221`（`createThread`）、`:679`（`createGlobalThread`）
- **判断依据**（双侧实读）：
    - SDK 发出：`body: { root_event_id: body.event_id, content: body.name ?? {} }`（`:236`、`:693`）
    - 后端：`synapse-web/src/routes/handlers/thread.rs:20-27`
        ```rust
        struct CreateThreadBody {
            #[serde(default)] room_id: Option<String>,
            root_event_id: String,
            #[serde(rename = "content")] _content: serde_json::Value,   // 下划线 = 未使用
            #[serde(rename = "origin_server_ts")] _origin_server_ts: Option<i64>, // 同上
        }
        ```
    - `_content` / `_origin_server_ts` 带下划线前缀 ⇒ **Rust 侧不读**，只为"接受该键"而声明。
- **影响**：`createThread(roomId, { event_id, name: "讨论" })` 的 `name` **永远不生效**，且因为字段名被接受（`content: Value` 接受任意 JSON），**不会报错**——属最难发现的静默丢弃。同时 `name?: string` 映射到 `content`（事件内容对象）语义错位。
- **修复建议**（二选一，需产品定）：
    1. 若线程标题应有语义：后端读 `_content`（或新增 `name` 字段）并在 `thread.rs` 落库；SDK 同步把 `name` 明确为"标题"。
    2. 若后端确实不支持：SDK **删除** `name` 参数（破坏性但诚实），JSDoc 注明"后端忽略 content，标题请用 `sendEvent` 发 `m.room.message` 承载"。

### 2.3 P2-02 `markThreadRead` 用**客户端本地时钟**伪造 `origin_server_ts`

- **严重度**：P2
- **涉及**：`src/thread/index.ts:440`
- **判断依据**：SDK 发 `body: { event_id: readUpTo, origin_server_ts: Date.now() }`；后端 `MarkReadBody { event_id: String, origin_server_ts: i64 }`（`thread.rs:51-54`）—— 字段名对，但值由客户端时钟生成。
- **影响**：已读位点的"时间"来自客户端时钟。若服务端据此做排序/水位判断，则客户端时钟偏差（含时区/手动改时）会污染数据；且同一事件在不同设备上报出不同的 `origin_server_ts`。
- **修复建议**：从本地事件缓存取该 `event_id` 的真实 `origin_server_ts`；取不到时应报错而非用 `Date.now()` 顶替（或明确文档化为"近似时间"）。

### 2.4 P2-03 两份契约/审计文档**互相矛盾**，且各错一半

- **严重度**：P2（会直接导致误判：把已有能力当缺口重做，或把真缺口当已完成）
- **判断依据与裁定**（本轮已回源）：

| 争议点                                                         | `ROUTE_CONTRACT.md` 附录 B                                | `artifacts/sdk-contract-gap-report.md` §7                              | **本轮回源裁定**                                                                                                                                                                                      |
| -------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /_matrix/client/v3/admin/room/{id}/redact`               | B.6「✅ 已核实无问题」（`admin-room-manager.ts:480-486`） | 「🔴 真缺口：`grep redact src/admin` → **0 命中**」                    | **附录 B 对**：`src/admin/sub-managers/admin-room-manager.ts:640` 有 `redactRoomEvents()`，path `/admin/room/{roomId}/redact`（`:652`）。缺口报告的 grep 结论不成立                                   |
| `/_matrix/client/unstable/org.matrix.msc4155/rooms/{}/threads` | —（未涉及）                                               | 「🔴 真缺口：全仓除 route-table 外**没有任何 `/threads` 路径字面量**」 | **结论对、表述误导**：SDK 封的是 **v1 稳定版**（`thread/index.ts:192` → `tp("/rooms/{id}/threads")` + `THREAD_PREFIX_V1`）。unstable MSC4155 变体确无调用点，但"没有任何 `/threads` 字面量"与事实不符 |
| `/_matrix/client/unstable/org.matrix.msc2965/auth_issuer`      | M-07：**回退即 404 的死路径，应删**                       | 「🔴 真缺口，需补 `OidcManager.getAuthIssuer()`」                      | **附录 B 对**：`src/client-auth.ts:55-61` 已按"铁律"删除该回退并注明原因。缺口报告的建议与附录 B 直接冲突                                                                                             |

- **影响**：同一端点在三份材料里三种结论，团队按任一份施工都可能做错方向。
- **修复建议**：以**代码实读**为准，把缺口报告 §7 的 2 条误判订正，并在两份文档间加交叉引用（"附录 B 与缺口报告的口径差异以 X 为准"）；缺口报告重跑时对 §7 结论强制人工复核（它已自述解析器有盲区）。

### 2.5 P3-01 SDK 参数名与契约字段名**系统性不一致**（暴露方式不当）

- **严重度**：P3（功能正确，但按契约写 SDK 代码会反复踩）
- **判断依据**：以下 5 处，SDK 侧参数名 ≠ 契约字段名，靠方法体内部映射兜住：

| 方法                | SDK 参数             | 契约字段                                                               | 位置                            |
| ------------------- | -------------------- | ---------------------------------------------------------------------- | ------------------------------- |
| `searchThreads`     | `{ term }`           | `q`（`thread.rs:56` `SearchQuery.q`，**必填**）                        | `thread/index.ts:252`           |
| `addFriend`         | `{ reason }`         | `message`（`friend_room.rs::AddFriendRequest`，`deny_unknown_fields`） | `friend-request-manager.ts:151` |
| `batchGetSummaries` | `isSuggestedOnly`    | `suggested_only`（`room_summary.rs`，`deny_unknown_fields`）           | `room-summary/index.ts:578`     |
| `markThreadRead`    | `readUpTo`           | `event_id`（`thread.rs:52`）                                           | `thread/index.ts:440`           |
| `createThread`      | `{ event_id, name }` | `root_event_id` + `content`（`thread.rs:20-27`）                       | `thread/index.ts:221`           |

- **影响**：`docs/sdk/*` 是**给 SDK 使用者看**的契约，它写 `q`/`message`/`suggested_only`，而 SDK 的公开参数是另一套名字 ⇒ 读者要维护两套心智模型。虽然 JSDoc 里有解释（部分带"2026-10-09 实测"注记），但分散在 5 个文件。
- **修复建议**：出一份「契约字段 ↔ SDK 参数」对照表（放 `docs/api-contract/` 或各 Manager 的 `README`），并在 `docs/sdk/*` 每篇的端点处补一行"SDK 侧参数名"。**不建议**现在改名（破坏性且换不来功能收益）。

### 2.6 P2-04 T3「仅声明 79 条」未逐条定性

- **严重度**：P2（无法区分"死声明"与"真未接通"）
- **判断依据**：`compare-routes` 报 `T3 仅声明 79`；附录 B.7 自述 T3 含**已知解析器盲区**（分布：key_backup 18 / media 15 / assembly 13 / cas 9 / push_notification 4 / msc4108 3 / room_summary 3 / oidc 2 / thread 2 / friend_room 1），并实测 key_backup 的 `room_keys/keys` 族**实际已实现**（`rust-crypto/backup.ts:624/691/756/772/977`）。
- **影响**：79 条里若混有真缺口，会被"声明面已覆盖"的指标掩盖（95.2% 的分子包含它们）。
- **修复建议**：按 B.7 的分布逐模块复核（预计大半是 `getUrl(relative, prefix)` 形态的解析器盲区）；复核后把盲区登记进解析器，或将解析器补上该形态，使 T3 收敛。

### 2.7 P3-02 契约文档计数已过期并存两套口径

- **严重度**：P3
- **判断依据**：附录 B 头注「后端事实源：本文件路由面（**1030 条路由 / 65 模块**）」；当前实测 `all=1038`（distinct 1033）。附录 B 自己也指出 `generate_sdk_ledger_fixtures.sh` 的「all=1407」是陈旧注释，但 **1030 同样已成历史**。README.md 则用 1019（default）/959（golden），与附录 B 的 1030 并存于同一目录体系。
- **影响**：读者无法判断哪个数是"当前事实"。审查/对账时会拿错分母。
- **修复建议**：附录 B 头部改为「审计时点（2026-10-09）口径：1030」并加一行"当前口径见 README §API 版本前缀"；README 的 1019 保持（它与 fixture 实测一致）。

### 2.8 P3-03 G-01 app_service 通配代理仍未决（唯一未闭环项）

- **严重度**：P3（附录 B 自评 P2，但性质是"待决策"而非"欠开发"）
- **判断依据**：附录 B B.2 G-01：`synapse-web/src/routes/app_service.rs:722-723` 的 `any(proxy_to_as)` 挂在 `/_matrix/app/v1/proxy/{as_id}/{*path}` 与 `/_matrix/client/v1/proxy/{as_id}/{*path}`，SDK 无任何消费者。
- **影响**：如产品需要"客户端经 homeserver 代理到 AS"，则缺能力；否则不应封（纯透传，SDK 加一层反而模糊错误语义）。
- **修复建议**：产品明确后再动；若要封，只封客户端面那条（`/_matrix/client/v1/proxy/...`），并暴露为 `AsProxyManager.request(asId, path, init)`，返回原始 `Response` 而非解析后的 JSON。

### 2.9 已验证**无问题**（防后续误报留痕）

| 契约条款（README）                  | SDK 实现                                                                                                      | 结论                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 204 No Content 必须能兜住           | `src/http-api/fetch.ts:402-404`：`if (res.status === 204 \|\| res.status === 205)` 统一返回空                 | ✅ 满足（还多容忍 205） |
| 无 `{status,data}` 信封             | 各 Manager 直接返回业务对象（如 `getInviteBlocklist(): Promise<AdminInviteBlocklist>`）                       | ✅ 满足                 |
| 401 不应按单一 errcode 判断 refresh | `src/http-api/errors.ts:174-183`：`M_UNKNOWN_TOKEN \|\| M_MISSING_TOKEN \|\| M_UNAUTHORIZED` 统一视为鉴权失败 | ✅ 满足                 |
| Token 只走 `Authorization` 头       | 全仓无 `?access_token=` 拼接（非鉴权媒体面按契约走 `/_matrix/media/v3/*`）                                    | ✅ 满足                 |

> 一处**待确认**（未定性）：`src/sliding-sync-sdk.ts:589` 单独判 `error.errcode === "M_UNKNOWN_TOKEN"`。若该分支用于"sliding sync 遇到 token 失效即重建连接"属合理特例；若用于决定 refresh，则与 README「不要用 errcode 判断是否需要 refresh」冲突。本轮未展开（需读该分支的完整上下文）。

## 3. 附录 B 27 条复核状态

| 类别       | 条目                               | 状态                      | 关键证据（SDK 侧）                                                                       |
| ---------- | ---------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------- |
| 功能遗漏   | G-01 app_service 通配代理          | ⬜ **未做**（待产品决策） | —                                                                                        |
|            | G-02 admin media protect/unprotect | ✅ 已修                   | `admin-media-manager.ts:208` `protectMedia`、`:224` `protectMediaById`、unprotect 同文件 |
|            | G-03 account 三面 submitToken      | ✅ 已修                   | `account/index.ts:52-54` 三面路径表（register/password/threepid）                        |
| 接口不匹配 | M-01 media 签名下载                | ✅ 已修                   | `media/index.ts:541-546` 出现 `download_signed`                                          |
|            | M-02 cas 服务列表裸数组            | ✅ 已修                   | `cas/index.ts:208-224` `Array.isArray(raw)` 兼容 + 注释标根因                            |
|            | M-04 thread 房间话题列表           | ✅ 已修                   | `thread/index.ts:192` 参数已为 `include_all`                                             |
|            | M-05 thread 搜索                   | ✅ 已修                   | `:250` `queryParams: { q: params.term, … }`                                              |
|            | M-06 e2ee 密钥请求字段             | ✅ 已修                   | `room-keys/index.ts:41` `status: "pending" \| "cancelled" \| "fulfilled"`                |
|            | M-07 oidc 发现回退                 | ✅ 已修                   | `client-auth.ts:55-61` 删除 `auth_issuer` 死路径并注明                                   |
| 参数传递   | P-01 room_summary 批量摘要         | ✅ 已修                   | `room-summary/index.ts:578` 发 `suggested_only`；`:617` 兼容 `is_suggested_only` 别名    |
|            | P-02/P-03 thread 创建（房间/全局） | ✅ 已修                   | `thread/index.ts:236`/`:693` 发 `root_event_id`（`name` 另有问题，见 §2.2）              |
|            | P-04 thread 创建回复               | ✅ 已修                   | `:559` 签名与 body 均为 `{event_id, root_event_id, content}`                             |
|            | P-05 thread 标记已读               | ✅ 已修                   | `:440` 发 `{event_id, origin_server_ts}`（值可疑，见 §2.3）                              |
|            | P-06 thread 订阅                   | ✅ 已修                   | `:468` 发 `{notification_level: "all"}`                                                  |
|            | P-07 cas proxy                     | ✅ 已修                   | `cas/index.ts:450` `queryParams: { target_service }`                                     |
|            | P-08 cas validate 系列 pgtUrl      | ✅ 已修                   | `cas/index.ts:326/339/345`                                                               |
|            | P-09 cas 注册服务                  | ✅ 已修                   | `:240` 透传 `CasServiceCreateRequest`（含 `service_id`/`name`/`service_url_pattern`）    |
|            | P-10 e2ee 创建密钥请求             | ✅ 已修                   | `e2ee/index.ts:129` `algorithm: string`                                                  |
|            | P-11 e2ee 列表分页                 | ✅ 已修                   | `device-keys/index.ts:455` `if (options?.limit !== undefined) params.limit = …`          |
|            | P-12 friend 添加好友               | ✅ 已修                   | `friend-request-manager.ts:151` 发 `message: opts?.reason`                               |
| 响应解析   | R-01 thread 回复列表裸数组         | ✅ 已修                   | `thread/index.ts:524` `request<IThreadReply[]>`                                          |
|            | R-02 thread 话题详情               | ✅ 已修                   | `:307` `request<IThreadDetail>`                                                          |
|            | R-03 cas 校验响应格式              | ✅ 已修                   | `cas/index.ts:450` 起 `textResponse: true` + `parseCasXmlResponse`                       |
|            | R-04 media 分块上传字段            | ✅ 已修                   | `media/index.ts:142/146/154/168-172` 全部改为 `uploaded_*`/`total_size`/`content_uri`    |
|            | R-05 e2ee 创建密钥请求响应         | ✅ 已修                   | 旧类型 `RoomKeyRequestResponse` 已消失（0 命中）                                         |
|            | R-06 密钥请求列表分页              | ✅ 已修                   | `device-keys/index.ts:171` `next_batch?: string \| null` + 注释标 R-06                   |

**统计：26 / 27 已修，1 待决策，0 未修。**

## 4. 优化方案（按优先级，可直接落地）

### P0 — 把契约底座追平（一次性，阻止后续全部判断失真）

```bash
cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk
# ① 预演（只读，报 模块 +N/-N）
node scripts/contract-sync.mjs --check --source=../synapse-rust/tests/unit/fixtures/ledger_export_sdk
# ② ingest（自底向上第一步）
node scripts/contract-sync.mjs --source=../synapse-rust/tests/unit/fixtures/ledger_export_sdk
# ③ codegen（第二步；顺序颠倒会被 route-set-parity 抓）
node scripts/sdk-contract-codegen.mjs
# ④ 受守文档计数（CONTRACT_INDEX.md 行/合计、contract-artifacts.md 的后端全量与 route-table 条目数）
node scripts/quality/check-docs-counts.mjs
# ⑤ 全链
pnpm quality:contracts
```

预期：`app_service` +2（MSC4512 `fed_proxy` 两条）、default 1017→**1019**、all 1036→**1038**、worker 1028→**1030**。
**必须一次提交**（sync 与 codegen 是同一不变式的两半；只做 ③ 会被 `route-set-parity` 当场抓）。

### P1 — 修两处「静默失效」（用户可感知，但门禁抓不到）

1. **`createThread` 的 `name`**（§2.2）：先与产品确认"线程标题"是否应有语义。
    - 有语义 → 后端 `thread.rs` 读 `_content`（或加 `name` 字段）并落库；SDK 保持参数名不动。
    - 无语义 → SDK 删 `name` 参数 + JSDoc 说明（并在 `CHANGELOG` 标 breaking）。
2. **`markThreadRead` 的 `origin_server_ts`**（§2.3）：改为从本地事件缓存取真实 ts；取不到时抛错，不用 `Date.now()` 顶替。

### P2 — 修文档互斥，消除误判源

3. 订正 `artifacts/sdk-contract-gap-report.md` §7 的 2 条（redact 误报、msc4155 表述），并在两份文档间加"以何为准"的交叉引用（§2.4）。
4. 把 T3 79 条按附录 B.7 的分布逐模块复核，结论回写进解析器或文档（§2.6）。

### P3 — 降低读者心智成本

5. 出「契约字段 ↔ SDK 参数」对照表；在 `docs/sdk/*` 每个端点处补一行"SDK 侧参数名"（§2.5）。
6. 附录 B 头部标注"审计时点 2026-10-09 口径 1030"，并指回 README 的当前口径（§2.7）。
7. G-01 由产品决策后再动（§2.8）。

## 5. 复现命令（全部只读）

```bash
# 契约镜像 vs 最新 fixture（关键：必须带 --source）
node scripts/contract-sync.mjs --check --source=../synapse-rust/tests/unit/fixtures/ledger_export_sdk

# 覆盖面与缺口（三级证据；--output 必须显式给临时路径，否则会覆盖 tracked 报告）
node scripts/audit/compare-routes.mjs --output /tmp/audit-routes-$(date +%F).md

# 单点证据示例
grep -n "content: body.name" src/thread/index.ts                  # §2.2
sed -n '20,54p' ../synapse-rust/synapse-web/src/routes/handlers/thread.rs   # §2.2/§2.3 后端类型
grep -n "redactRoomEvents" src/admin/sub-managers/admin-room-manager.ts     # §2.4 裁定
```

---

**审查边界**：本轮按「契约 → SDK 封装面」为主线，未逐个核对 1019 条端点的**响应字段级**一致性（该项由 `quality:admin-response-contract` 与 `quality:wire-format` 两个半场门禁持续守护，本轮抽查的 4 条全局契约与 26 条附录 B 项均通过）。若需字段级全量复核，建议以 `wire-format` 的 `comparable` 桶为起点扩展（当前 80 条可比对，其余落在 `sdk-keys-unknown:*` / `backend-body-unknown` 等未知桶）。
