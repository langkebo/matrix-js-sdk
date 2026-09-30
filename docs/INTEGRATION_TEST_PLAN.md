# SDK ↔ 后端联调测试方案

> **项目**: `@langkebo/matrix-js-sdk` (fork) × `synapse-rust` (后端)
> **联调环境**: `https://matrix.test`
> **方案版本**: v1.0（2026-09-30）
> **负责人**: SDK 审计组

---

## 目录

1. [联调环境确认与连接方式](#1-联调环境确认与连接方式)
2. [API 接口覆盖范围与优先级划分](#2-api-接口覆盖范围与优先级划分)
3. [SDK 调用场景与参数映射](#3-sdk-调用场景与参数映射)
4. [预期结果与断言规则](#4-预期结果与断言规则)
5. [日志与错误处理机制](#5-日志与错误处理机制)
6. [测试数据准备](#6-测试数据准备)
7. [联调步骤与时间表](#7-联调步骤与时间表)
8. [问题反馈与跟进流程](#8-问题反馈与跟进流程)
9. [附录](#9-附录)

---

## 1. 联调环境确认与连接方式

### 1.1 环境基线（已验证 2026-09-30 18:00）

| 项目 | 值 | 验证方式 | 状态 |
|------|-----|---------|------|
| 后端地址 | `https://matrix.test` | `GET /_matrix/client/versions` | ✅ 200 |
| 协议版本 | r0.5.0 ~ v1.14 | 同上 | ✅ 完整 |
| Server Name | `matrix.test` | `/.well-known/matrix/client` → `m.homeserver.base_url` | ✅ |
| 健康检查 | `/health`、`/_health` | HTTP 状态码 | ✅ 200 |
| 未认证请求 | 返回 `M_MISSING_TOKEN` | `GET /_matrix/client/v3/account/whoami` | ✅ 符合规范 |
| 不稳定特性 | 20 个 MSC 已启用（含 MSC3245/3266/3814/3886/4140/4143 等） | versions 响应 | ✅ |

### 1.2 已知环境限制与规避

| 限制 | 影响 | 规避方式 |
|------|------|---------|
| Admin API 需要 server admin 权限（`@lt_admin_final:matrix.test` 是普通用户） | 无法使用 `/_synapse/admin/v1/users` 等管理接口做断言 | 联调用 **client API 主链路**；Admin 类用例标记 `SKIP_ADMIN`，仅在拿到管理员 token 后启用 |
| HTTPS 为自签证书 | Node 默认拒绝连接 | SDK `request` 层设置 `https.Agent({ rejectUnauthorized: false })`，或环境变量 `NODE_TLS_REJECT_UNAUTHORIZED=0`（仅测试进程内） |
| 注册开放但需两步流程（`m.login.dummy`） | 自动建号需要处理 UIA session | 见 §6.2 注册辅助函数 |
| 数据库不可直接访问 | 无法做落库级断言 | 所有断言基于 **HTTP 响应 + 二次读接口回查** |

### 1.3 SDK 连接方式（联调代码骨架）

```typescript
// spec/integ/real-backend/helpers/sdk-connection.ts（新增）
import { createClient, MatrixClient } from "../../../src/index";

export async function connectTestUser(username: string, password: string): Promise<MatrixClient> {
    const client = createClient({
        baseUrl: "https://matrix.test",
    });
    const loginResponse = await client.loginWithPassword(username, password);
    // 重新绑定带 token 的实例
    return createClient({
        baseUrl: "https://matrix.test",
        accessToken: loginResponse.access_token,
        userId: loginResponse.user_id,
        deviceId: loginResponse.device_id,
    });
}
```

**HTTPS 处理**：在 vitest `globalSetup` 中一次性执行
`process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"`（不要放进产品代码）。

**环境开关**：

| 变量 | 默认 | 说明 |
|------|------|------|
| `MATRIX_REAL_BACKEND_BASE_URL` | `https://matrix.test` | 复用 `TestConfig.ts` 既有约定 |
| `MATRIX_REAL_BACKEND_SKIP_ADMIN` | `true` | Admin 类用例跳过开关 |
| `REAL_BACKEND_INTEG` | 未设置 → **全跳过** | 防止误触发网络依赖的 CI 跑挂 |

现有 25 个 real-backend spec 已有此目录约定，本方案沿用 **不另起炉灶**。

---

## 2. API 接口覆盖范围与优先级划分

### 2.1 覆盖原则

- 以 `docs/ROUTE_CONTRACT.md`（SDK 封装的路由契约）为源清单，逐条对照后端 `/versions` + 实测可用性。
- 优先级依据：**Tjg 前端实际调用频率 × 数据风险 × 语义复杂度**。
- 每条路由在联调报告中必须落位于四种状态之一：`PASS / FAIL / SKIP(原因) / DEVIATED(语义偏差)`。

### 2.2 P0 —— 消息主链路（必须全绿才能放行）

| # | SDK 模块 | 后端路由 | 验证语义 |
|---|---------|---------|---------|
| 1 | `RoomManager.sendMessage` | `POST /_matrix/client/v3/rooms/{roomId}/send/{eventType}/{txnId}` | txnId 幂等去重（同 txnId 重复发送返回同一 event_id） |
| 2 | 同上（已存在 `send-txn-dedup.spec.ts`） | 同上 | 保持回归 |
| 3 | `messages` 分页 | `GET /_matrix/client/v3/rooms/{roomId}/messages?dir=b&limit=N` | `end/begin` 游标正确性、同 ms 时间戳分页稳定性（已有 spec，回归） |
| 4 | `sync` 增量 | `GET /_matrix/client/v3/sync?since=…&timeout=0` | 增量事件到达、`limited` 标志 |
| 5 | 读回执 | `POST /_matrix/client/v3/rooms/{roomId}/receipt/m.read/{eventId}` | receipt 写入 + `hasUserReadEvent` 回查 |
| 6 | 房间创建/加入 | `POST /createRoom`、`POST /rooms/{id}/join` | 别名生成、membership 状态回查 |
| 7 | Typing/Presence | `PUT /presence/…`、`PUT typing` | ephemeral 事件经 sync 下发 |

### 2.3 P1 —— Space / 房间组织（前端文件树依赖）

| # | SDK 模块 | 后端路由 | 验证语义 |
|---|---------|---------|---------|
| 8 | `SpaceHierarchyManager.getSpaceChildren` | `GET /v1/rooms/{roomId}/hierarchy` | chunk 结构、`children_state` 完整性 |
| 9 | `SpaceChildManager.addChild/removeChild` | `PUT/DELETE m.space.child state` | state event 生效 + 缓存失效语义（联动 SDK 内 `query.clearCache()`） |
| 10 | `createFileTreeSpaceRequest`（MSC3088） | `POST /createRoom` 带 `type=m.federated_tree_space` + `m.room.creation_content` | 后端是否保留 room type（对照 unstable feature） |
| 11 | `RoomStatsManager` | `GET /rooms/{id}/state` 等 | member/topic/avatar 聚合正确性 |
| 12 | `SpaceQueryManager.getPublicSpaces` | `POST /publicRooms` | `chunk` 归一化、分页 `next_batch` |

### 2.4 P2 —— 安全与设备（E2EE 相关，回归为主）

| # | SDK 模块 | 说明 |
|---|---------|------|
| 13 | keys/upload、keys/query | OTK 上传计数、device_keys 分发 |
| 14 | `e2ee-otk-exhaustion.spec.ts` | 已有，回归 + 与最新 SDK 签名核对 |
| 15 | backup: `POST /room_keys/version` 等 | 既有 `key-backup-recover-scope.spec.ts` 回归 |
| 16 | cross-signing secret storage | 既有 spec 回归 |
| 17 | device list updates | 既有 spec 回归 |

### 2.5 P3 —— 管理/监控（条件执行）

| # | SDK 模块 | 条件 |
|---|---------|------|
| 18 | `AdminUserManager.*` | 需管理员 token（当前 `SKIP_ADMIN`） |
| 19 | `ApplicationServiceManager.listAppServices` | 同上 |
| 20 | `WorkerManager`（11 路由） | 同上 |

### 2.6 明确排除项

- Federation S2S 路由（已评估不需要，见 2026-09-30 第四批记录）。
- `sliding-sync`（走独立 proxy，不在本次 synapse-rust 范围）。
- 已废弃 r0.x 特有行为。

---

## 3. SDK 调用场景与参数映射

### 3.1 场景矩阵（每场景 = 一个 `it()` 块）

| 场景 ID | 前置条件 | SDK 调用 | 后端预期路由 | 断言要点 |
|--------|---------|---------|-------------|---------|
| MSG-01 | 双用户已在房间 A | `alice.sendTextMessage(roomA, "hi")` | `POST …/send/m.room.message/{txn}` | 返回 event_id 非空；bob `sync` 能收到 |
| MSG-02 | 紧接 MSG-01，**复用同一 txnId** 重发 | 同上 | 同上 | 返回 **相同** event_id（幂等） |
| MSG-03 | 房间内有 ≥20 条消息 | `getMessagePager(roomA, { dir: 'b', limit: 10 })` | `GET …/messages` | page1 尾部游标 = page2 顶部；无重复/遗漏 |
| RECEIPT-01 | MSG-01 完成 | `bob.setRoomReadMarkers(roomA, { read: eventId })` | `POST …/receipt` | 200；`hasUserReadEvent(alice, eventId)` 经 bob sync 后可见 |
| SPACE-01 | alice 建 space S + 子房间 C | `hierarchy.getSpaceChildren(S)` | `GET /v1/rooms/S/hierarchy` | C 出现在 children，`via` 非空 |
| SPACE-02 | SPACE-01 完成 | `childManager.removeChild(S, C)` | `DELETE state m.space.child` | 再次 hierarchy 查询 C 消失；SDK 缓存失效（第二次调用不打网络需 mock 层验证） |
| TREE-01 | — | `createFileTreeSpaceRequest(client, "树", { isFirstTree: true })` | `POST /createRoom` | 响应含 room_id；`getStateEvent(type)` 返回 `m.federated_tree_space`（若后端剥离 type 则记 DEVIATED） |
| LOGIN-01 | 预建账号 | `loginWithPassword(user, pwd)` | `POST /login` | access_token / user_id / device_id 三元组齐备 |
| LOGIN-02 | LOGIN-01 后 logout | `client.logout()` | `POST /logout` | 后续 whoami 返回 401 `M_UNKNOWN_TOKEN` |
| REG-01 | — | 两步 dummy 注册 | `POST /register` ×2 | home_server = matrix.test；is_guest=false |
| PRES-01 | 双用户 | `alice.setPresence("online")` | `PUT /presence` | bob `GET /presence/{alice}` 状态一致 |

### 3.2 参数映射表（SDK 层 → HTTP 层关键字段）

| SDK 入参 | HTTP 字段 | 联调关注点 |
|---------|----------|-----------|
| `limit`（messages 分页） | `limit` query | 后端上限裁剪行为（>服务器 max 时是否钳制） |
| `txnId` | path 末段 | 是否真正参与去重（MSG-02 核心假设） |
| `visibility`（publicRooms） | body | `public` vs `private` 过滤 |
| `suggested` / `order`（space child） | `m.space.child` content | 字段透传保真 |
| `m.login.dummy` + session | `auth` body | UIA 两步流程 session 复用正确性 |
| room `type`（MSC3088） | `creation_content.type` | 后端是否保留（TREE-01） |

### 3.3 明确不在 SDK 侧断言的点

- 服务器内部性能指标（已有独立 Prometheus 基准线，见审计文档 §13.7）。
- 响应延迟 SLA（联调只验证**功能正确性**；性能走 `perf/benchmarks.spec.ts` 体系）。

---

## 4. 预期结果与断言规则

### 4.1 通用断言规则

1. **状态码语义**：SDK 内部已把 Matrix 错误码映射为 `MatrixError`。断言优先用 `errcode` 而非裸 status code。
2. **每次写操作必须回查**：写接口返回 200 ≠ 生效；必须用一次**独立读接口**（sync/messages/state/hierarchy）验证副作用。这是本方案与既有 mock 单测的本质区别。
3. **幂等性双跑**：凡带 txnId / session 的接口，断言"两次调用返回相同标识"。
4. **超时分级**：沿用 `TestConfig.timeout`（short 5s / medium 15s / long 30s）。sync 长轮询用 `timeout=0` 显式关掉。
5. **每用例数据隔离**：房间名带 `Date.now()+random` 后缀；用户名带时间戳前缀（见 §6）。
6. **断言失败时输出契约快照**：`expect(onError).toMatchObject({ errcode, error })` 保留后端原文，便于回填问题单。

### 4.2 各场景预期结果明细

| 场景 | 成功判据（全部满足才算 PASS） |
|------|------------------------------|
| MSG-01 | `event_id` 匹配 `\$[A-Za-z0-9_-]+`；bob `sync(since)` 增量含该事件且 `type=m.room.message` |
| MSG-02 | 两次 `event_id` **全等**；bob 侧 sync **不出现重复事件** |
| MSG-03 | 两页合并去重后数量 = 实际发送数；`end`/`begin` 游标衔接无重叠窗口 |
| RECEIPT-01 | `POST receipt` 200；bob sync 的 `ephemeral.receipts` 含 `m.read` |
| SPACE-01 | children 数组包含 C 的 `state_key`，`origin_server_ts` > 0 |
| SPACE-02 | remove 后 hierarchy 无 C；二次 SDK 调用网络层被命中（vi.spyOn(http.request) 计数为 0 或 1） |
| TREE-01 | `room_id` 非空且 `!` 开头；creation_content/`m.room.create` 回读含 `type` |
| LOGIN-01/02 | 登录三元组齐备；登出后 whoami `M_UNKNOWN_TOKEN` |
| REG-01 | `user_id` = `@<期望前缀>:matrix.test`；`access_token` 非空 |
| PRES-01 | GET 回读 presence `currently_active`/`presence` 与写入一致 |

### 4.3 失败分类

- **FAIL-FUNC**：功能不符（返回错误码/字段缺失）。
- **FAIL-DATA**：数据污染（重复事件、丢事件、缓存脏读）。
- **DEVIATED**：后端行为与 SPEC/SDK 假设语义不同但"看起来能用"——记入语义偏差清单，进 SDK 审计 B2 维度。
- **ENV**：环境问题（DNS/证书/服务未起），不计入 SDK 缺陷。

---

## 5. 日志与错误处理机制

### 5.1 日志分层

| 层 | 手段 | 内容 |
|----|------|------|
| 用例级 | `console.log("[IT][场景ID] step")` | 关键步骤打点（发送→等待→回查） |
| SDK 级 | `logger.setLevel(LogLevel.DEBUG)`（仅 FAIL 时） | 请求/响应体、重试 |
| HTTP 级 | vitest `onConsoleLog` 钩子聚合 | 每用例结束输出 `request→status` 摘要行 |
| 报告级 | `spec/integ/real-backend/reports/run-<timestamp>.md` | 每场次的 PASS/FAIL/SKIP 清单 + 失败原文 |

### 5.2 错误处理规则

1. **环境失联快速失败**：`beforeAll` 里探测 `/_matrix/client/versions`，3 秒不通 → 整个 describe 标 SKIP（`ctx.skip()`），避免假 FAIL。
2. **断言失败保留现场**：全局 `afterEach` 钩子里，若 `expect.getState().currentTestName` 失败，dump 最后 20 条 SDK debug 日志到报告。
3. **网络抖动重试**：仅对 `ENV` 类瞬时错误（ECONNRESET/timeout 且非断言路径）允许 vitest `retry=1`，且重试必须在报告中标注。
4. **敏感信息脱敏**：access_token 在报告中一律替换为 `syt_***` 前 8 位；沿用仓库既有 `quality:log-sensitive` 门禁要求。
5. **清理兜底**：`afterAll` 对本场次创建的房间执行 `leaveRoom`（不删除，留给后端数据观测）；用户不清理（可复用池，见 §6）。

### 5.3 与既有门禁的关系

- 本联调属于 `REAL_BACKEND_INTEG` 环境守卫的独立 runner，**不进** `pnpm test:unit` 与 CI `systemic_refactor_quality_gate`（后者保持纯离线确定性）。
- 新增 npm script：`"test:real-backend": "REAL_BACKEND_INTEG=1 vitest run spec/integ/real-backend --config vitest.integ.config.ts"`。

---

## 6. 测试数据准备

### 6.1 账号池策略

| 账号角色 | 数量 | 用途 | 管理方式 |
|---------|------|------|---------|
| 管理员（admin） | 1（仅备） | Admin 端点验证 | 手工预建，`@lt_admin_final:matrix.test` |
| 普通测试用户 | 每场场次 2~4 个 | 双向消息、receipt、presence 对照 | `REAL_BACKEND_INTEG=1` 后 `beforeAll` 用两步 dummy 流程自动建号（username = `it_${ts}_${rand}`）；首次成功后写 `spec/integ/real-backend/.tokens.json` 缓存，后续场次复用 |
| 机器人/负载用户 | 按需 | 不在功能联调内 | 性能测试专属 |

**账号创建辅助函数（示例）**

```typescript
// spec/integ/real-backend/helpers/createTestUser.ts
export async function createTestUser(prefix='it'): Promise<{userId:string, accessToken:string, deviceId:string}> {
    const username = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    const password = "TempPass123!";
    // 1) 起始 /register
    const start = await fetch("https://matrix.test/_matrix/client/v3/register", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({type:"m.login.dummy"}),
    }).then(r=>r.json());
    // 2) 完成两步
    // ...
    return { userId, accessToken, deviceId };
}
```

### 6.2 房间资源预建

- **隔离命名规则**：房间别名 `it-space-YYYYMMDD-HHMMSS-<rand>`、房间名 `IT Test Room <timestamp>`。
- **空间结构**：`createParentSpace()` -> `createChildRoom()` -> `addChild()`；结构树深度 ≤2，保证可读性。
- **数据清理**：失败用例在 `afterEach` 中记录房间 ID，场次 `afterAll` 批量 `leaveRoom`。
- **并发冲突**：`create` 失败且 `errcode=M_ROOM_IN_USE` 时退避 100ms 重试至 3 次。

### 6.3 测试数据种子

| 用例 | 需要的数据 | 来源 |
|------|-----------|------|
| MSG-01/03 | Room A：双用户已加入 | 用例前置自动建房 |
| RECEIPT-01 | MSG-01 事件 ID | 用例内部传递 |
| SPACE-01/02 | Space S（含子房间 C） | 用例前置 `createSpaceTree` |
| TREE-01 | 无 | `createFileTreeSpaceRequest` 直接执行 |
| PRES-01 | 双用户同时在线 | 两个 client 并发持有 token |

### 6.4 环境依赖最小集合

- 仅依赖 `TestConfig.ts` 既有约定：`baseUrl`、`timeout`、`retry`。
- 不依赖 Postgres/Docker 内网访问；所有交互走 Matrix Client HTTP API。
- Admin API 用例全标记 `SKIP_ADMIN`（当前权限不足）。

---

## 7. 联调步骤与时间表

### 7.1 阶段划分

| 阶段 | 验证场景 | 产出 |
|------|---------|------|
| **P1** 环境基线 | `versions`、`health`、`whoami`、`joined_rooms` | `baseline.md`（自动生成） |
| **P2** P0 消息链路 | MSG-01/02/03、RECEIPT、LOGIN、PRES | `report/P0-YYYYMMDD.md` 100% PASS |
| **P3** Space/树结构 | SPACE-01/02、TREE-01 | `report/P1-YYYYMMDD.md` |
| **P4** E2EE/备份 | keys/query/upload、key-backup、cross-signing | 回归报告，与已有 mock 单测对照 |
| **P5** Admin/S2S | 仅在获取管理员 token 后开启 | 标记为可选里程碑 |

### 7.2 每轮执行顺序（建议）

1. `vitest run spec/integ/real-backend/baseline.spec.ts` → 快速确认环境。
2. P0 消息链路（并行最多 2 个 client）→ 若失败立刻 dump log，**暂停后续**。
3. Space/树结构 → 与后端 room v12 合规工作交叉验证（MSC4289/4291/4297/4307）。
4. E2EE/备份 → 夜间执行（耗时较长）。
5. 汇总报告 → 自动推送到 `docs/INTEGRATION_TEST_PLAN.md` 时间线。

### 7.3 成功标准（里程碑）

- **M0（环境可达）**：baseline.spec 全部 PASS；`versions` 响应耗时 < 800ms。
- **M1（P0 消息）**：MSG/RECEIPT/LOGIN/ PRES 场景 **≥95% PASS** 且零 FAIL-FUNC。
- **M2（Space）**：Space Hierarchy、Add/Remove Child、FileTree Space 请求正确且缓存失效生效。
- **M3（E2EE/Backup）**：覆盖路线 13-17 的 25 个关键用例。

---

## 8. 问题反馈与跟进流程

### 8.1 问题分类与闭环

| 类别 | 示例 | 处理方 | 闭环要求 |
|------|------|--------|---------|
| FAIL-FUNC (SDK 层) | 事件去重失效 | SDK 审计组 | 修改 SDK 封装 → 重新联调 → 回填 `sdk-encapsulation-audit-v2.md` |
| DEVIATED (后端语义) | `m.federated_tree_space` 被剥离 | synapse-rust 组 | 记录偏差清单 → 评估是否需 SDK 适配或后端修复 |
| ENV | 证书错误、网络超时 | DevOps | 修复或标记 `SKIP` |

### 8.2 反馈模板（建议置于 `docs/INTEGRATION_DEFECTS.md`）

```markdown
## [IT-日期] 场景ID 摘要
- 场景：MSG-02
- 预期：两次发送返回相同 event_id
- 实际：返回不同 event_id
- 复现步骤：...
- SDK 版本 / 后端 commit：...
- 日志片段：...
- 分类：FAIL-FUNC / FAIL-DATA / DEVIATED / ENV
- 建议修复方向：...
```

### 8.3 知识同步

- 每轮完成后在 `sdk-encapsulation-audit-v2.md` 中更新 **Backend Alignment Matrix**。
- 若发现 backend 语义与 SDK 假设不符，同步更新 `docs/ROUTE_CONTRACT.md` 对应路由的 **semantic note**。
- 与 matrix-sdk-fork 审计线交叉：若出现 `SDK 能力不存在`（B1）或 `契约镜像新鲜度失效`（B4），立刻在审计队列中新增条目。

---

## 9. 附录

### 9.1 目录结构建议

```
matrix-js-sdk/
├─ docs/
│  ├─ INTEGRATION_TEST_PLAN.md           ← 本文档
│  ├─ ROUTE_CONTRACT.md
│  └─ INTEGRATION_DEFECTS.md（待创建）
├─ spec/
│  └─ integ/
│     ├─ real-backend/
│     │  ├─ helpers/
│     │  │  ├─ sdk-connection.ts
│     │  │  ├─ createTestUser.ts
│     │  │  └─ baseline-check.ts
│     │  ├─ baseline.spec.ts
│     │  ├─ messages-p0.spec.ts
│     │  ├─ space-p1.spec.ts
│     │  └─ reports/
│     └─ ...
```

### 9.2 与既有联调入口的关系

- 现有 25 个 spec（admin-manager、auth-test-helpers… 已存在）**保持不动**。
- 本方案提供的 `messages-p0.spec.ts` / `space-p1.spec.ts` **新增**，采用与现有相同的 `TestConfig` 与 token 缓存。
- `spec/integ/real-backend/` 目录是 **独立的 real-backend runner**，已在本合同前通过 `ls` 验证存在。

### 9.3 前置条件清单（首次运行前）

- [ ] `https://matrix.test/_matrix/client/versions` 200 OK。
- [ ] `NODE_TLS_REJECT_UNAUTHORIZED=0` 或信任 CA 配置在测试进程。
- [ ] `REAL_BACKEND_INTEG=1` 开关（若未设置，所有 real-backend test 退出 0）。
- [ ] SDK 可通过 `createClient({baseUrl: "https://matrix.test"})` 发起请求。
- [ ] 管理员 token 未配置 → 确认 `SKIP_ADMIN` 标记生效。
- [ ] CI 环境变量 `REAL_BACKEND_INTEG` 保持未设置，避免意外网络请求。

### 9.4 与 synapse-rust room v12 合规的交叉点

- **MSC4289（room version v12）**：Space Hierarchy API 需验证 `state_events` 版本字段是否随 room version 正确返回。
- **MSC4291/4297/4307**：File Tree Space 与 `m.room.creation_content.type` 保留问题 → 与 TREE-01 联调结果直接关联。
- 若后端在 v12 中对 `m.space.child` 语义做出变更，需同步更新 SDK `space-child-manager.ts` 缓存失效策略（已知 `query.clearCache()` 调用点）。

---

## 更新日志

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-09-30 | v1.0 | 首次发布，覆盖环境基线、P0/P1/P2 分层、场景矩阵、问题闭环与目录规划。后续随着联调进展逐次迭代。 |

*本文档为活文档：每轮联调后补充实际数据、PASS 比例与偏差记录，保持与 `docs/ROUTE_CONTRACT.md` 同步。*

