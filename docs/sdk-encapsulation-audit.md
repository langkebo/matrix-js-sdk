# SDK 封装与语义一致性审计报告（@langkebo/matrix-js-sdk vs Sprint 4 后端）

> 日期：2026-09-18（初版） / **2026-09-30（最终状态更新，见第 13 节）**  
> 审计范围：`@langkebo/matrix-js-sdk` fork vs Sprint 4 后端语义对齐  
> 基准：后端 ledger (`synapse-rust/tests/unit/fixtures/ledger_export_sdk/all.json` HEAD `7cb39946`)

> ⚠️ **阅读提示**：本文档第 1-12 节为 2026-09-18 ~ 09-29 的**历史审计记录**，其中的覆盖率数据已被  
> 2026-09-30 的实施结果取代。**请以第 13 节「模块完成状态总表」为准**。  
> 历史章节保留是为了追踪决策链路与 Bug 修复证据。

---

## 执行摘要

| 审计维度           | 状态               | 详细说明                                                                                             |
| ------------------ | ------------------ | ---------------------------------------------------------------------------------------------------- |
| **路由声明覆盖**   | ✅ 89.2% (684/767) | 客户端面路由实现覆盖率                                                                               |
| **MSC 语义一致性** | ✅ 已对齐          | MSC4204/4155/3967/4156/4267 均在 `docs/MSC_SEMANTICS.md` 中明确标注                                  |
| **真缺口**         | 0                  | 2 条历史缺口已全部修复                                                                               |
| **草案 API**       | 3 项               | `Takedown`、`getInvitePermissionConfig`、`setInvitePermissionConfig`，标注 "Draft — not implemented" |

---

## 1. MSC 语义对照（Sprint 4 视角）

### 1.1 编号借用模式（非错配）

| MSC 编号    | 官方原始语义         | Sprint 4 后端实际语义                 | SDK 封装状态                                          | 文档位置                                 |
| ----------- | -------------------- | ------------------------------------- | ----------------------------------------------------- | ---------------------------------------- |
| **MSC4204** | 改密默认吊销设备     | 改密默认吊销设备（实为 MSC2457 能力） | `PolicyRecommendation.Takedown` 标注为 Draft          | `src/models/invites-ignorer-types.ts:38` |
| **MSC4155** | Invite filtering     | 线程订阅读接口                        | `ThreadingManager.getSubscribedThreads()` ✅ 正常工作 | `src/invite-blocklist/index.ts:280-281`  |
| **MSC3967** | Cross-signing 免 UIA | `/sync` 增量 state token              | 无需专属封装（正常消费 `/sync`）                      | `docs/MSC_SEMANTICS.md`                  |
| **MSC4156** | join/knock via 参数  | join/knock via 参数                   | ✅ 完全对齐                                           | `docs/MSC_SEMANTICS.md`                  |
| **MSC4267** | 原子 leave+forget    | 原子 leave+forget                     | ✅ 完全对齐                                           | `docs/MSC_SEMANTICS.md`                  |

**结论**：所有 MSC 编号借用均为**有意设计**，非语义错配。SDK 注释已在位。

### 1.2 草案 API（后端零消费）

| API                                                  | 位置                                    | 行为                     | 调用结果                   |
| ---------------------------------------------------- | --------------------------------------- | ------------------------ | -------------------------- |
| `PolicyRecommendation.Takedown`                      | `src/models/invites-ignorer-types.ts`   | 类型合法                 | 后端不消费 → 404           |
| `InviteBlocklistManager.getInvitePermissionConfig()` | `src/invite-blocklist/index.ts:276-306` | 读取 Global Account Data | 事件未设置 → 降级为 `null` |
| `InviteBlocklistManager.setInvitePermissionConfig()` | `src/invite-blocklist/index.ts:308-340` | 写入 Global Account Data | 仅写入，后端不做邀请过滤   |

**验证命令**：

```bash
# 后端：草案 API 消费方必须为 0
grep -rn "m\\.takedown" --include=*.rs src synapse-services synapse-common
grep -rn "invite_permission_config" --include=*.rs .

# SDK：草案标注必须在位
grep -rn "Draft — not implemented by synapse-rust" src
```

---

## 2. 路由实现完整性审计

### 2.1 覆盖率统计

| 分类         | 后端路由数 | SDK 实现数 | 覆盖率 |
| ------------ | ---------- | ---------- | ------ |
| **客户端面** | 660        | 589        | 89.2%  |
| **服务端面** | 366        | 328        | 89.6%  |
| **SSO 根级** | 13         | 12         | 92.3%  |
| **总计**     | 1039       | 929        | 89.4%  |

### 2.2 真缺口分析（0 条）

历史缺口修复记录：

- ✅ `GET /_matrix/client/unstable/org.matrix.msc2965/auth_issuer` → `src/client-auth.ts:60`
- ✅ `POST /_matrix/client/v3/admin/room/{room_id}/redact` → `src/admin/AdminRoomManager.redactRoomEvents()`

**当前状态**：客户端面真缺口 = **0**

---

## 3. Sprint 4 主 Ticket 对应关系

| Ticket            | MSC 编号     | 后端交付               | SDK 封装                                              | 一致性      |
| ----------------- | ------------ | ---------------------- | ----------------------------------------------------- | ----------- |
| **Sprint #4-T01** | MSC4204      | 改密默认吊销设备       | `PasswordAuthManager.revokeDevicesOnPasswordChange()` | ✅ 一致     |
| **Sprint #4-T02** | MSC4267      | 原子 leave+forget      | `RoomManager.leave(roomId, { forget? })`              | ✅ 一致     |
| **Sprint #4-T03** | MSC3967      | /sync 增量 state token | 正常消费 `/sync`                                      | ✅ 无需封装 |
| **Sprint #4-T04** | MSC4155/4156 | 线程订阅               | `ThreadingManager.getSubscribedThreads()`             | ✅ 一致     |

**证据**：

- Commit `56d03326`（MSC4204）
- Commit `fadf125e`（MSC4267）
- Commit `237a7620`（MSC3967）
- Commit `cb8843a4`（MSC4155/4156）

---

## 4. 关键 API 核查清单

### 4.1 Thread 功能

| API                      | 后端路由                                                 | SDK 封装                                         | 状态 |
| ------------------------ | -------------------------------------------------------- | ------------------------------------------------ | ---- |
| `getSubscribedThreads()` | `GET /_matrix/client/v1/threads/subscribed`              | `ThreadingManager.getSubscribedThreads(params?)` | ✅   |
| `createGlobalThread()`   | `POST /_matrix/client/v1/threads`                        | `ThreadingManager.createGlobalThread(body)`      | ✅   |
| `muteThread()`           | `POST /_matrix/client/v1/rooms/{rid}/threads/{tid}/mute` | `ThreadingManager.muteThread(roomId, threadId)`  | ✅   |

**验证**：

```typescript
// src/thread/index.ts:506-517
async getSubscribedThreads(params?: { from?: string; limit?: number }): Promise<IThreadListResponse> {
    const path = tp("/threads/subscribed");
    return this.request<IThreadListResponse>({
        method: Method.Get,
        path: path,
        queryParams: params,
        prefix: THREAD_PREFIX_V1,
    });
}
```

### 4.2 AppService 功能

| API                       | 后端路由                                     | SDK 封装                                                 | 状态        |
| ------------------------- | -------------------------------------------- | -------------------------------------------------------- | ----------- |
| `registerAppService()`    | `POST /_synapse/admin/v1/appservices`        | `ApplicationServiceManager.registerAppService()`         | ✅          |
| `getApplicationService()` | `GET /_synapse/admin/v1/appservices/{as_id}` | `ApplicationServiceManager.getApplicationService(as_id)` | ✅          |
| `listAppServices()`       | `GET /_synapse/admin/v1/appservices`         | ❌ 缺失                                                  | ⚠️ 建议补充 |

### 4.3 Push Gateway 澄清

**用户问题**：后端无 `push_gateway` 相关路由，需澄清具体含义。

**排查结果**：

- Matrix 标准 `push_gateway` API：`/_matrix/push/v1/notify`（推送到 Push Gateway）
- Matrix 标准 `pushers` API：`/_matrix/client/v3/pushers`（管理 Pusher）
- 本后端 ledger：仅有 `pushers` 管理路由，无 `push/gateway`

**可能解释**：

1. 用户指的是 Matrix 标准的 push notification 投递（客户端 → Push Gateway → APNS/FCM），不属于 SDK 封装范畴
2. 用户指的是 Pusher 管理功能（`/_matrix/client/v3/pushers`），SDK 已封装

---

## 5. 文档与路径指针一致性

### 5.1 后端路径指针更新

| 文件                                                             | 旧路径                                      | 新路径                                 | 状态 |
| ---------------------------------------------------------------- | ------------------------------------------- | -------------------------------------- | ---- |
| `Tjg/src/services/matrix/rendezvous/MatrixRendezvousService.ts`  | `synapse-rust/src/web/routes/rendezvous.rs` | `synapse-web/src/routes/rendezvous.rs` | ✅   |
| `Tjg/src/services/matrix/paths/moderation.ts`                    | `synapse-rust/src/web/routes/moderation.rs` | `synapse-web/src/routes/moderation.rs` | ✅   |
| `Tjg/src/services/matrix/media/__tests__/voice.contract.test.ts` | `synapse-rust/src/web/routes/voice.rs`      | `synapse-web/src/routes/voice.rs`      | ✅   |

### 5.2 审计文档同步

| 文档                                   | 更新内容         | 状态 |
| -------------------------------------- | ---------------- | ---- |
| `Tjg/docs/sdk-encapsulation-audit.md`  | 更新后端路径指针 | ✅   |
| `artifacts/sdk-encapsulation-audit.md` | 更新后端路径指针 | ✅   |

---

## 6. 越层调用指标重定义

### 6.1 旧指标（不再使用）

- authedRequest 42 处（文本匹配，含类型声明/注释）
- \_synapse/ 24 处（均为路径常量，非越层）

### 6.2 新指标

- **SDK 越层调用点**：12 处（真·越层）
- **判定标准**：直接调用 SDK 底层 API + 拼接完整路径 + 非适配器层特殊场景

**详见**：`Tjg/docs/越层调用指标重定义报告 -2026-09-18.md`

---

## 7. 行动建议优先级

| 优先级 | 行动                                       | 理由                               | 工作量 |
| ------ | ------------------------------------------ | ---------------------------------- | ------ |
| **P0** | 维持现有 MSC 语义标注                      | `docs/MSC_SEMANTICS.md` 完整且在位 | 0      |
| **P1** | 补充 `AppServiceManager.listAppServices()` | 后端已支持，SDK 封装不完整         | 2h     |
| **P2** | 澄清 `push GATEWAY` 具体需求               | 可能为非 SDK 职责或误解            | 待澄清 |
| **P3** | 迁移 `UserService.getUserById()` 至 SDK    | 消除唯一真越层调用                 | 4h     |

---

## 8. 复核命令

```bash
# 1. 验证 MSC 语义文档标注
grep -rn "Draft — not implemented by synapse-rust" /Users/ljf/Desktop/hu_ts/matrix-js-sdk/src

# 2. 验证 Thread next_batch 字段
grep -n "next_batch" /Users/ljf/Desktop/hu_ts/matrix-js-sdk/src/thread/index.ts

# 3. 验证后端 ledger 中不存在 push_gateway
python3 -c "
import json
d = json.load(open('/Users/ljf/Desktop/hu_ts/synapse-rust/tests/unit/fixtures/ledger_export_sdk/all.json'))
for e in d['entries']:
    if 'gateway' in e['path'].lower():
        print(e['path'])

# 4. 验证真越层调用点（预期 12 处）
./Tjg/scripts/check-overshoot.sh

# 5. 验证 Sprint 4 提交
cd /Users/ljf/Desktop/hu_ts/synapse-rust
git log --oneline --all | grep -E "56d03326|fadf125e|237a7620|cb8843a4"
```

---

## 9. 附录：完整路由清单

### 9.1 后端 Ledger 概览

```
总条目：1147
客户端面：660
服务端面：366
SSO 根级：13

模块分布（Top 10）：
  room: 102
  key_backup: 66
  space: 48
  e2ee: 44
  friend_room: 36
  assembly::account_compat: 36
  widget: 18
  voice: 16
  push: 17
  room_summary: 17
```

### 9.2 缺失 SDK 封装（建议补充）

| 后端路由                                 | 方法              | 优先级 |
| ---------------------------------------- | ----------------- | ------ |
| `GET /_synapse/admin/v1/appservices`     | listAppServices() | P1     |
| `GET /_synapse/admin/v2/users/{user_id}` | getUserById()     | P2     |

## 11. 新增功能：Admin Manager 完整封装 + CAS Manager Bug 修复 (2026-09-29)

### 11.1 Admin Manager 子模块完整封装

**目标**：完整封装 Synapse Admin API，覆盖 73 个路由

**已完成的子模块**:

| 子管理器                      | 路由数 | 测试数       | 状态 |
| ----------------------------- | ------ | ------------ | ---- |
| `AdminCleanupManager`         | 12     | ✅ 8 tests   | 完成 |
| `AdminExternalServiceManager` | 12     | ✅ 10 tests  | 完成 |
| `AdminNotificationManager`    | 6      | ✅ 8 tests   | 完成 |
| `AdminPolicyManager`          | 7      | ✅ 6 tests   | 完成 |
| `AdminReportManager`          | 7      | ✅ 6 tests   | 完成 |
| `AdminRoomManager`            | 4      | ✅ 10 tests  | 完成 |
| **总计**                      | **48** | **48 tests** | ✅   |

**测试文件**:

- `spec/unit/admin/sub-managers/admin-cleanup-manager.spec.ts`
- `spec/unit/admin/sub-managers/admin-external-service-manager.spec.ts`
- `spec/unit/admin/sub-managers/admin-notification-manager.spec.ts`
- `spec/unit/admin/sub-managers/admin-policy-manager.spec.ts`
- `spec/unit/admin/sub-managers/admin-report-manager.spec.ts`
- `spec/unit/admin/sub-managers/admin-room-manager.spec.ts`

**测试结果**: 48 tests ✅

### 11.2 CAS Manager Bug 分析与修复计划

**问题描述**：CAS Manager 中路径构造与后端路由契约不一致

**具体问题**:

```typescript
// src/cas/index.ts:127
const path = prefix === "synapse_admin" ? "/admin/services" : "/cas/services";
```

**后端实际路由** (ROUTE_CONTRACT.md):

- `/_synapse/admin/v1/cas/services` - 服务管理（admin 前缀）
- `/_synapse/cas/services` - 服务管理（cas 前缀）

**修复计划**:

1. 更新 `resolvePath` 方法，正确处理两个前缀的路径
2. 补充测试用例验证路径构造
3. 运行全量 CAS 测试确保无回归

**优先级**: P1

### 11.3 综合测试覆盖统计

```bash
# 运行 Admin + CAS 测试
cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk && \
PATH="/usr/bin:/bin:$PATH" ./node_modules/.bin/vitest run \
  spec/unit/admin/ \
  spec/unit/cas.spec.ts

# 累计测试结果:
# - Space 相关：79 tests ✅
# - Admin 相关：48 tests ✅
# - Room Summary: 14 tests ✅
# - Event Report: 19 tests ✅
# - CAS: 10 tests ✅
# - SAML: 22 tests ✅
# - Push: 23 tests ✅
# **总计**: 215+ tests ✅
```

### 11.4 SDK 封装概览总结

| 模块         | 路由数   | 测试数   | 覆盖率   | 状态          |
| ------------ | -------- | -------- | -------- | ------------- |
| Space        | ~70      | 79       | 100%     | ✅            |
| Admin        | ~73      | 48       | 66%      | ✅ (进行中)   |
| Room         | ~45      | 14       | 31%      | ✅            |
| Room Summary | ~25      | 14       | 56%      | ✅            |
| Event Report | 18       | 19       | 106%     | ✅            |
| CAS          | 17       | 10       | 59%      | ⚠️ Bug 待修复 |
| SAML         | 16       | 22       | 138%     | ✅            |
| Push         | ~20      | 23       | 115%     | ✅            |
| E2EE         | ~25      | 15       | 60%      | ✅            |
| Media        | ~10      | 8        | 80%      | ✅            |
| Device       | ~15      | 12       | 80%      | ✅            |
| **总计**     | **350+** | **240+** | **~85%** | ✅            |

---

## 12. 待办事项 (2026-09-29)

### P1 - Bug 修复

- [ ] CAS Manager 路径构造修复
- [ ] 统一错误处理策略
- [ ] Room v12 默认版本协商实现

### P2 - 功能补全

- [ ] Worker Manager 封装 (11 routes)
- [ ] OIDC Manager 封装 (8 routes)
- [ ] Admin Manager 剩余路由覆盖

### P3 - 优化与门禁

- [ ] 统一缓存策略实现
- [ ] 测试覆盖率提升至 90%
- [ ] 建立自动化覆盖率门禁

---

## 13. 模块完成状态总表 (2026-09-30 最终状态)

> 本节为 2026-09-30 综合集成测试后的**最终状态快照**，取代第 11.4 节与第 12 节的旧数据。

### 13.1 七大模块完成情况

| 模块           | 后端路由 | SDK 方法          | 测试数 | 覆盖率  | 状态 | 备注                                                                                     |
| -------------- | -------- | ----------------- | ------ | ------- | ---- | ---------------------------------------------------------------------------------------- |
| **Room**       | 98       | +35 (Batch1 新增) | 14     | ❌ 作废 | 勘误 | ~~`RoomManagerExtensions.ts`~~ 已于 2026-10-05 删除，原「✅ 100%」是**伪覆盖**，见 §13.8 |
| **Admin**      | 166      | 238               | 48     | ✅ 100% | 完成 | 11 个子管理器                                                                            |
| **Assembly**   | 101      | 149               | 47     | ✅ 100% | 完成 | Auth/Discovery/Profile                                                                   |
| **AppService** | 39       | 20                | —      | ✅ 90%+ | 完成 | 剩余为非核心 admin API                                                                   |
| **Media**      | 36       | 19                | 45     | ✅ 100% | 完成 | 含 chunk upload + quota                                                                  |
| **Push**       | 17       | ~18               | 56     | ✅ 100% | 完成 | PushRules + Pusher + Notifications                                                       |
| **Federation** | 54       | ~36               | 41     | ⚠️ 88%  | 部分 | S2S 协议路由不属 client SDK 范围                                                         |

### 13.2 本轮新增功能 (Batch1-Batch4)

| 批次        | 模块     | 交付物                                                                               | 代码量   | 提交        |
| ----------- | -------- | ------------------------------------------------------------------------------------ | -------- | ----------- |
| **Batch 1** | Room     | ~~`RoomManagerExtensions.ts` + `.types.ts` + spec~~（2026-10-05 全部删除，见 §13.8） | 1,253 行 | `37ec9ffe0` |
| **Batch 2** | Admin    | 评估确认已完整（238 方法），无需实施                                                 | 0        | —           |
| **Batch 3** | Assembly | 评估确认已完整（149 方法），无需实施                                                 | 0        | —           |
| **Batch 4** | Media    | 评估确认已完整（19 方法），无需实施                                                  | 0        | —           |

### 13.3 综合集成测试结果

```bash
# 综合测试执行（⚠️ 2026-10-05 勘误：`RoomManagerExtensions.spec.ts` 已随源文件删除，
# 该行保留仅作历史记录；下方 14/14 不是任何可达代码的验证，见 §13.8）
cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk && \
PATH="/usr/bin:/bin:$PATH" ./node_modules/.bin/vitest run \
  spec/unit/media/media-manager.spec.ts \
  spec/unit/media.spec.ts \
  spec/unit/push/push-manager.spec.ts \
  spec/unit/federation.spec.ts \
  spec/unit/api-consistency/federation.spec.ts
```

| 测试套件                             | 测试数      | 状态               |
| ------------------------------------ | ----------- | ------------------ |
| ~~`RoomManagerExtensions.spec.ts`~~  | ~~14/14~~   | ❌ 已删除（§13.8） |
| `media-manager.spec.ts`              | 23/23       | ✅ PASS            |
| `media.spec.ts`                      | 22/22       | ✅ PASS            |
| `push-manager.spec.ts`               | 56/56       | ✅ PASS            |
| `federation.spec.ts`                 | 34/34       | ✅ PASS            |
| `api-consistency/federation.spec.ts` | 7/7         | ✅ PASS            |
| **总计**                             | **156/156** | ✅ **100%**        |

**TypeScript 编译**: 0 errors ✅

### 13.4 已修复的历史 Bug

| Bug                       | 模块     | 修复方式                                     | 提交        |
| ------------------------- | -------- | -------------------------------------------- | ----------- |
| Chunk upload 参数位置     | Media    | query param 而非 body (`ISSUE-04`)           | `a51f91a4c` |
| 上传大小预检缺失          | Media    | 消费 `m.upload.size` 客户端预检 (`ISSUE-07`) | `a51f91a4c` |
| CAS 路径构造错误          | CAS      | `resolvePath()` 统一前缀解析                 | `244da3aed` |
| 后端 CAS 路由缺 nest 前缀 | **后端** | `Router::new().nest("/_synapse/cas", ...)`   | 后端已修    |
| 空间缓存"声明未使用"      | Space    | 6 个子管理器真实接入 `UnifiedCacheManager`   | `1c41a4bee` |
| 6 个失败单测              | 多模块   | feature name / prefix / import path 修正     | `a51f91a4c` |

### 13.5 门禁与工具链

| 工具           | 路径                                           | 用途                                                                              |
| -------------- | ---------------------------------------------- | --------------------------------------------------------------------------------- |
| 覆盖率门禁     | `scripts/quality/check-repo-coverage.mjs`      | lcov 解析 + 阈值校验（P2-c 双轨制的「全仓」一轨；阈值读 `coverage-targets.json`） |
| 门禁可达性门禁 | `scripts/quality/check-gate-reachability.mjs`  | 判定「自称门禁的脚本是否真会被执行」，防死门禁（2026-10-05 新增）                 |
| API 覆盖率报告 | `scripts/generate-api-coverage-report.mjs`     | 模块级覆盖率统计                                                                  |
| 契约差集登记   | `scripts/quality/contract-drift-registry.json` | SDK-only 路由登记                                                                 |

> ⚠️ 已删除：`scripts/quality/check-minimum-coverage.mjs`（2026-10-05）。  
> 它被 `check-repo-coverage.mjs` 取代，且其解析依赖 lcov 的 `SUMMARY:` 块  
> （由 `lcov --summary` / genhtml 产出），而 vitest 的 lcov reporter 不写该块 ——  
> 即它在正常路径下也只会输出「无法从 lcov 报告中提取覆盖率数据」并 exit 1。

### 13.6 剩余待办

| 优先级   | 任务                                                | 状态                | 备注/完成证据                                                                                                                                                                                                                                                           |
| -------- | --------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1**   | `ApplicationServiceManager` appservice 路径契约修复 | ✅ **已修复**       | **2026-09-30 联调发现真实缺陷**：SDK 全部 14 处路径误用 `/application_services`（下划线），后端实际注册 `/_synapse/admin/v1/appservices`（无下划线）。已批量替换并回归 35/35 单测通过。详见 §13.6.1                                                                     |
| **P2-a** | SDK ↔ 后端路径契约交叉校验门禁                      | ✅ **已完成**       | 新增 `scripts/quality/verify-path-contract.mjs` + `path-contract-waivers.json`，挂进 `quality:contracts`。**变异自证通过**。详见 §13.6.3                                                                                                                                |
| **P2-b** | 调整 critical-module floorPercent 为实测值          | ✅ **已完成**       | 定向测量各模块（避免全仓跑触发限流）：admin 70.37% / dm 65.75% / space 77.21% / room-summary 73.23%。已更新 `critical-modules.json`（`measuredAt=2026-10-01`）。floor 是 ratchet，只能向上。                                                                            |
| **P2**   | `UserService.getUserById()` 越层调用迁移            | ✅ **已评估不需要** | `AdminUserManager.getUserById()` (`src/admin/sub-managers/admin-user-manager.ts:167`) 已收口至 SDK                                                                                                                                                                      |
| **P2-c** | 全仓覆盖率重定义为「关键模块 ≥85% + 全仓 ≥65%」     | ✅ 已实施           | 新增 `scripts/quality/coverage-targets.json` 记录双轨目标；`check-repo-coverage.mjs` 实现 lcov 加权汇总；`package.json` 增加 `quality:coverage`（全仓）`quality:coverage:critical`（关键模块）和 `quality:contracts`（路径门禁）三条 quality 编排，相互独立可单独重跑。 |
| **P3**   | Federation S2S 协议路由补齐                         | ⏸️ 评估为不需要     | 已评估                                                                                                                                                                                                                                                                  |
| **P3**   | 性能基准测试                                        | ✅ **已完成**       | 见第 13.7 节                                                                                                                                                                                                                                                            |

### 13.6.1 P1 缺陷：appservice 路径契约不符（联调发现，2026-09-30）

#### 现象

在 `https://matrix.test` 上用 server admin token 实测：

```bash
# SDK 使用的路径 → 404
curl -H "Authorization: Bearer $ADMIN" \
  https://matrix.test/_synapse/admin/v1/application_services
# → {"errcode":"M_UNRECOGNIZED","error":"Unrecognized request"}

# 后端真实路径 → 200
curl -H "Authorization: Bearer $ADMIN" \
  https://matrix.test/_synapse/admin/v1/appservices
# → []
```

#### 根因

| 侧   | 路径                                      | 来源                                                                |
| ---- | ----------------------------------------- | ------------------------------------------------------------------- |
| SDK  | `/_synapse/admin/v1/application_services` | `src/app-service/index.ts` 14 处硬编码                              |
| 后端 | `/_synapse/admin/v1/appservices`          | `synapse-web/src/routes/app_service.rs:728-742`（16 条 admin 路由） |

SDK 侧从单测到集成测试全部自洽（mock 层不校验真实路径），因此该缺陷在纯 mock 测试下**完全不可见**——这正是"单测全绿 ≠ 联调通过"的典型案例。

#### 影响面

`ApplicationServiceManager` 的 **全部 14 个方法**均受影响，包括：  
`registerAppService` / `getApplicationService` / `updateApplicationService` /  
`unregisterApplicationService` / `listApplicationServices` / `pingApplicationService` /  
`getApplicationServiceState` / `setApplicationServiceState` / `listApplicationServiceUsers` /  
`getApplicationServiceNamespaces` / `listApplicationServiceEvents` /  
`getApplicationServiceStatistics` / `queryApplicationServiceUser` / `queryApplicationServiceAlias`

另 2 处 `checkUserId` / `checkAlias` 走 `/_matrix/client/v3/appservice/*`（**正确**，不受影响）。

#### 修复内容

1. `src/app-service/index.ts`：14 处 `path: "/application_services..."` → `"/appservices..."`
2. 同文件 2 处注释同步更新
3. 响应归一化字段：`application_services?` → `services?`（后端返回裸数组，该分支为兼容兜底）
4. `spec/unit/app-service.spec.ts`：9 处路径断言同步更新

#### 回归验证

```
spec/unit/app-service.spec.ts   29 tests ✅
spec/unit/appservice.spec.ts     6 tests ✅
总计                            35/35 ✅
```

#### 审计方法论教训 → 已落地为 P2-a 门禁

> **B2 维度（SDK 能力存在性）的反向缺口**：审计时只检查"SDK 有没有这个方法"，  
> 没有检查"这个方法打的 URL 对不对"。

该教训已转化为 CI 门禁，见 §13.6.3。

#### 提交记录

- Commit: `27b459196`
- 分支: `feat/sdk-contract-gap-implementation`

### 13.6.2 P2 任务完成详情

#### P2-c 后续任务：覆盖率目标重定义（双轨制，2026-10-01）

**背景**：原文档要求"全仓 90% 行覆盖"。实测全仓覆盖率约 46%（文档数据可能过期），  
若要达到 90% 需要数千新增用例。更重要的是：

- 全仓 `vitest run --coverage` 在本环境跑 16 分钟，触发 `Retry-After: 2` 限流
- 某些模块（如 EventManager）已达 99%，而其他模块（dm/index.ts）仅 65.75%

**新目标**（双轨制）：

| 轨道         | 指标                                             | 目标             | 用途                                    |
| ------------ | ------------------------------------------------ | ---------------- | --------------------------------------- |
| **关键模块** | `src/{admin,dm,space,room-summary,...}/index.ts` | ≥85%             | 保护核心业务逻辑的测试完整性            |
| **全仓**     | 所有 `src/**/*`                                  | ≥65%             | 防止代码库整体测试退化                  |
| **路径契约** | SDK → 后端路径静态匹配率                         | 100%（豁免登记） | 防止 URL 拼错这类 mock 层检测不到的缺陷 |

**实施**：

- `scripts/quality/coverage-targets.json`：双轨目标配置（含注释说明为何分开）
- `scripts/quality/check-repo-coverage.mjs`：全仓门禁，按 LF/LH 加权聚合（避免小文件稀释）
- `vitest.config.ts`：全局阈值从 80% 下调到 65%（与全仓 floor 对齐）
- `package.json`：新增 `quality:coverage:repo` / `quality:coverage:critical` / `quality:contracts` 三条独立门禁，可分别重跑

**历史背景**: 原审计文档（2026-09-18）指出"唯一真越层调用"为 `Tjg 前端直接调用后端 Admin User API`，建议通过 SDK 收口。

**现状核实** (2026-09-30):

- `AdminUserManager.getUser(userId, throwOnError)` 已存在 (`src/admin/sub-managers/admin-user-manager.ts:110-159`)
- `AdminUserManager.getUserById(userId, throwOnError)` 作为语义化别名也已实现 (`:167-169`)
- 后端路由 `GET /_synapse/admin/v2/users/{userId}` 已完整支持

**评估结论**: 越层调用问题**已通过既有 SDK 方法解决**，无需额外迁移工作。任务关闭。

### 13.6.3 P2-a：SDK ↔ 后端路径契约交叉校验门禁（2026-10-01）

#### 动机

§13.6.1 的 P1 缺陷暴露了审计方法的盲区：**单测全绿 ≠ 路径正确**。mock 层不校验真实 URL，  
所以拼错前缀这类缺陷在纯 mock 环境下完全不可见。P2-a 建门禁把这类缺陷左移到 CI。

#### 交付物

| 文件                                         | 作用                                              |
| -------------------------------------------- | ------------------------------------------------- |
| `scripts/quality/verify-path-contract.mjs`   | 门禁主体                                          |
| `scripts/quality/path-contract-waivers.json` | 20 条已登记豁免                                   |
| `package.json`                               | `quality:path-contract`，挂进 `quality:contracts` |

#### 工作原理

1. 从后端 ledger（`synapse-rust/tests/unit/fixtures/ledger_export_sdk/all.json`，**1149 条**）读出注册路由建索引
2. 从 SDK 源码提取 `(prefix, path, method)` 三元组，拼接成完整路径后比对
3. 参数化路径归一化：`{roomId}` / `$roomId` / `:roomId` → `{X}`
4. 拼接后路径不在 ledger → 报错，并给出 ledger 中最接近的候选路径

#### 实现中解决的提取难题

| 难题            | 症状                                                                 | 解法                                              |
| --------------- | -------------------------------------------------------------------- | ------------------------------------------------- |
| 字段顺序不固定  | `path` 在 `body` 前、`prefix` 在 `body` 后，相隔 12 行               | 锚定 `method:` + 括号配平扫描对象范围             |
| 默认前缀        | 位置参数调用无 `prefix:` 字段                                        | 补 `DEFAULT_PREFIX`（依据 `base-manager.ts:269`） |
| 位置参数第 5 参 | `authedRequest(..., undefined, undefined, { prefix })` 读不到 prefix | 扩展扫描参数列表尾部                              |
| 注释里的示例    | JSDoc `@example` 含完整 request 示例                                 | `stripComments()` 状态机（保留列宽维持行号）      |
| 模板字面量前缀  | `` `${ClientPrefix.Unstable}/org.matrix.msc4143` ``                  | 加模板解析分支                                    |

匹配率演进：21/128 → 62/128 → 100/128 → 102/124 → **104/124 + 20 豁免，0 不匹配**

#### 门禁抓到的第二个真实缺陷（双前缀）

`src/room/RoomManager.ts:1277` 的 `getClientConfig()` 同时传了完整路径和 prefix：

```typescript
// 修复前 —— 实际拼成 /_matrix/client/v3/_matrix/client/v1/config/client
this.request({ method: Method.Get, path: "/_matrix/client/v1/config/client", prefix: ClientPrefix.V3 });

// 修复后
this.request({ method: Method.Get, path: "/config/client", prefix: ClientPrefix.V1 });
```

`getSSOUserInfo()`（`:1291`）同样问题。两者均已修复。

#### 变异自证（关键）

把 P1 缺陷重新注入（`/appservices` → `/application_services`），验证门禁**确实能抓**：

```
$ python3 -c "把 src/app-service/index.ts 的 /appservices 改回 /application_services"
$ node scripts/quality/verify-path-contract.mjs
exit=1  (期望 1)
  不匹配       : 1
  POST /_synapse/admin/v1/application_services
$ # 恢复代码后
✅ 全部静态请求路径均与后端 ledger 一致
```

证明门禁不是空跑（不会因为提取器没抓到东西而"永远绿"）。

#### Waiver 设计：防"豁免注水"

借鉴 `check-manager-codegen-coverage.mjs` 的 `WAIVED_MODULES` 思路，三条约束：

1. 每条豁免必须同时有 `reason` 和 `expires`，缺任一 → 门禁 exit 2
2. **过期即失败** —— 强制定期复核
3. **未被引用的豁免也失败** —— 后端补齐后忘记删条目，会让门禁失败面被旧条目遮住

20 条豁免分类：

| 类别                    | 数量 | 说明                                                                                                 |
| ----------------------- | ---- | ---------------------------------------------------------------------------------------------------- |
| MSC3882 设备签名验证    | 9    | 后端只实现了 `upload`，`verify_*` / `qr_code` 全系列未实现                                           |
| device-trust / security | 4    | 后端路由文件零命中                                                                                   |
| 其他单点                | 7    | `oidc/register`、`login/get_token`、`register/captcha`、`login/failures`、`federation/blacklist` × 2 |

> `federation/blacklist` 值得注意：后端只在 `synapse-web/src/utils/admin_auth.rs:236`  
> 的**鉴权规则**里预留了路径（标记为敏感操作），但从未注册路由（ledger 零条目）。  
> 说明后端预留了接口但没实现。

#### 动态路径扩展（2026-10-01）

门禁已增强以覆盖**模板字面量路径**，效果：

| 指标     | P2-a (e0e8808c) | 增强后        |
| -------- | --------------- | ------------- | ------------- |
| 提取调用 | 124             | 242 (+118)    |
| 匹配成功 | 104             | 218           | 218 ✅        |
| 动态跳过 | 165 → 47 (-118) | 47            | 44 ✅         |
| 不匹配   | 0               | 18 处真实缺口 | 0 (已豁免) ✅ |
| 豁免数   | 20              | 30            | 6 (精简后) ✅ |

归一化增强：

- 正则：`\$\{?(\w+)\}?` → `\$\{[^}]*\}`（覆盖 `${encodeURIComponent(x)}`）
- 双重前缀检测：自动识别完整路径（`/_matrix/client/v3/...`）并跳过 prefix 拼接

**18 处不匹配待甄别**（invite-blocklist 4 处 client/v3→vendor/v1，app-service 4 处 appservices/ 路由待确认等）。  
详见 commit `745ccdb53`。

#### 最终验证结果（93a92c84e）

- 真缺陷修复：
    - invite-blocklist: client/v3 → vendor/v1 (4 处路径 + 注释)
    - ~~RoomManagerExtensions.translate: GET → POST (1 处)~~ —— 该文件已于 2026-10-05 删除（§13.8）；此条随之失效
- 豁免表精简：从 30 条降至 6 条真实缺口
- 门禁状态：✅ 全部通过

#### 6 条真实缺口明细（path-contract-waivers.json）

1. **POST /\_matrix/client/v1/login/get_token** — 第三方登录 token 交换（后端仅内部方法，非 HTTP 路由）
2. **GET /\_matrix/client/v3/register/captcha** — 注册 captcha 校验（后端未实现）
3. **POST /\_matrix/client/v3/oidc/register** — OIDC registration（后端未实现）
4. **GET /\_matrix/client/v3/rtc/transports** — MSC4143 RTC transports（SDK 前缀错误，应为 unstable）
5. **GET /\_matrix/client/unstable/im.nheko.summary/summary/{X}** — nheko summary（后端未实现，回退路径）
6. **DELETE /\_matrix/client/v3/voice/{X}** — 删除语音消息（后端未实现 DELETE）

#### MSC 编号错误修正（用户指出）

- ❌ 原文档错误：将 MSC3882 称为 "Device signature verification"
- ✅ 正确：MSC3882 = "Allow an existing session to sign in a new session"
- ❌ 原文档错误：将 MSC3720 称为 "Account status" 但实际是用户状态
- ✅ 正确：MSC3720 = "Account status"（用户状态 API）

**真实后端路由清单**（synapse-rust @ 7cb39946，1149 entries）：

- appservices: GET/POST/PUT/DELETE /\_synapse/admin/v1/appservices/{as_id}/\*
- voice: GET/POST /\_matrix/client/v3/voice/\* (无 DELETE)
- federation: 完整 S2S 路由表（详见 ledger）

#### 提交记录

- Commit: `93a92c84e`
- 回归：门禁验证全部通过（224 calls / 218 matched / 6 waived / 0 mismatch）
- 增强功能：HTTP 方法校验 + MSC 编号格式校验

### 13.7 性能基准测试结果（2026-09-30）

#### 测试文件

- **`spec/unit/integration/cross-module.spec.ts`** — 跨模块集成测试（16 个测试）
- **`perf/benchmarks.spec.ts`** — 性能基准测试（11 个测试）

#### 运行命令

```bash
cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk && \
PATH="/usr/bin:/bin:$PATH" ./node_modules/.bin/vitest run \
  --exclude "**/Tjg/**" --exclude "**/.pnpm-store/**" --exclude "**/.worktrees/**" \
  spec/unit/integration/cross-module.spec.ts perf/benchmarks.spec.ts
```

#### 测试结果汇总

| 测试套件                      | 测试数    | 状态        | 平均耗时 |
| ----------------------------- | --------- | ----------- | -------- |
| `cross-module.spec.ts` (集成) | 16/16     | ✅ PASS     | -        |
| `benchmarks.spec.ts` (性能)   | 11/11     | ✅ PASS     | 详见下方 |
| **总计**                      | **27/27** | ✅ **100%** | -        |

#### 详细性能数据

**Cache Operations** (目标 < 1ms):

- Cache set/get: **0.00 ms** ✅
- Cache hit (getOrFetch): **0.00 ms** ✅
- Wildcard invalidation: **< 2ms** ✅
- LRU eviction: **< 2ms** ✅

**LRUCache Internals** (目标 < 5-10ms):

- Batch set (100 items): **< 5ms** ✅
- Batch get (100 items): **< 5ms** ✅
- Mixed read/write: **< 3ms** ✅
- Eviction stress (200 items, 10 rounds): **< 10ms** ✅

**String Operations** (目标 < 2-3ms):

- encodeURIComponent: **< 3ms** ✅
- String normalization: **< 2ms** ✅

#### 关键发现

1. **Space 子管理器实际不使用 UnifiedCacheManager**：只有 `hierarchyCache` 在 `SpaceHierarchyManager` 中使用，之前设计的"member/lifecycle 写操作后缓存失效"场景不成立，测试已调整为聚焦真实基础设施层。
2. **CacheStats 接口无 name 字段**：实际结构为 `{size, maxSize, hits, misses, hitRate, evictions, expiredPurges}`。
3. **LRUCache 延迟检查过期**：只有在 get() 时才会检查 TTL，set 后立即等待过期可能观察不到预期行为。
4. **所有性能指标远超目标阈值**：cache ops < 0.01ms，远低于 < 1ms 的目标。

#### 提交记录

- Commit: `e1cbedc92`
- Branch: `feat/sdk-contract-gap-implementation`
- Files: `spec/unit/integration/cross-module.spec.ts`, `perf/benchmarks.spec.ts`

### 13.8 勘误（2026-10-05）：`RoomManagerExtensions` 伪覆盖更正

> 本节**推翻 §13.1 / §13.2 / §13.3 / §13.6.3 中关于 Room 模块「✅ 100%」的全部结论**。原结论是把一批**没有任何调用方**的函数算进了覆盖率，属于伪信号，不是能力。

#### 现象与证据

`src/room/RoomManagerExtensions.ts`（915 行 / 52 个 `export async function`）与其 spec 曾被记为「Room 100% 覆盖（14/14 PASS）」。逐项实测（2026-10-05）：

| 判据                   | 实测结果                                                                                                                                                                                        | 取证方式                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **不可达**             | 0 生产消费者。`src/room/index.ts` 仅 `export * from "./RoomManager"`，不导出该文件；`package.json` 无对应子路径导出                                                                             | `git grep -n RoomManagerExtensions -- . ':!node_modules' ':!lib'` 仅命中自身 / 本文档 / 自身 spec                                             |
| **重复实现**           | 52 个端点中 ≥14 个已有正规实现                                                                                                                                                                  | `pinned-messages`×3、`RoomManager`×5、`room-alias`、`room-event-operation-manager`×2、`room-member`、`read-receipts`、`client-batch-requests` |
| **DTO 不可信**         | `getUnreadCount()` 声明 `{ unread_count: number }`，而同一端点 `GET /rooms/{room_id}/unread_count` 的正规实现 `RoomManager.getRoomUnreadCount()` 返回 `{ notification_count, highlight_count }` | 源码对读；39 个未测函数里同类「猜测型 DTO」无法排除                                                                                           |
| **绕过契约**           | 参数一律 `client: any`，路径写死绝对字面量 `/_matrix/client/v3/rooms/...`，不经 `rp()` / `_rsv()`                                                                                               | 因此后端改路由时它**不会**编译失败 —— 契约驱动的编译期保护对它完全失效                                                                        |
| **制造伪信号（外部）** | 它让 `artifacts/sdk-contract-gap.json` 把 `GET /rooms/{room_id}/visibility` 等记为「T2 已构造」，虚高实现面覆盖率                                                                               | `artifacts/sdk-contract-gap.json` → `t2Only[].evidence.file`                                                                                  |
| **测试面**             | 52 个函数只测了 13 个，且这 13 个恰好包含上面那批**重复实现**；knip 报的 39 个死导出正是**未被测的剩余部分**                                                                                    | `./node_modules/.bin/knip` → `Unused files (1): src/room/RoomManagerExtensions.ts`                                                            |

#### 处置

- `git rm src/room/RoomManagerExtensions.ts`、`git rm spec/unit/room/RoomManagerExtensions.spec.ts`（连同此前的 `RoomManagerExtensions.types.ts`）。
- **能力未丢失**：52/52 条路径全部存在于后端契约（`docs/api-contract/generated/modules/room.json`，99 条）并已被 codegen 渲染进 `src/room/__generated__/route-table.ts`。将来产品真需要其中某个端点时，正确做法是按契约在对应管理器上加**类型化方法**（`rp()` 会在编译期证明路径存在），而不是复活这个文件。
- **未封装现状已有台账**：`artifacts/sdk-contract-gap-report.md`（三级证据法）持续记录「后端有 / SDK 未封装」的路由，删除该文件后需重跑 `scripts/audit/compare-routes.mjs` 让数字回到诚实值。

#### 结论（可迁移的教训）

> **「有函数 + 有测试」不等于「有能力」。** 判据必须是「从包入口可达 ∧ 有真实消费者」。  
> 一个不可达的文件只要有测试，就能同时骗过覆盖率门禁和文档门禁 —— 这正是本次把它从「Room 100%」降级为「作废」的原因。

### 13.9 契约归属断裂（2026-10-05）：`room-summary` 的实现调用 `room` 模块的路由

> 本节记录一类**结构性**缺陷：实现的**物理位置**与契约里的**模块归属**不一致，导致该文件无法使用编译期路径断言 —— AGENTS.md 承诺的「拼错是编译错误」在它身上不成立。

#### 现象与证据

`src/room-summary/sub-managers/room-event-operation-manager.ts`（939 行 / 42 次 HTTP 调用）是该模块最大的未覆盖文件。它的请求路径分三类：

| 判据                                      | 实测结果 | 取证方式                                                                 |
| ----------------------------------------- | -------- | ------------------------------------------------------------------------ |
| 文件内可解析的路径（归一化后）            | **14**   | `probe-route-module-attribution.mjs` + 契约比对                          |
| 归属 `room_summary` 契约（可用 `_rsv()`） | **3**    | `docs/api-contract/generated/modules/room_summary.json`（21 条）         |
| 归属 `room` 契约（**无法**用 `_rsv()`）   | **11**   | `docs/api-contract/generated/modules/room.json`（99 条）                 |
| 文件内实际使用断言函数的次数              | **3**    | `grep -c "_rsv\(\|_rsi\("` → 3，其余 40 处为裸 `string` 传给 `request()` |

复验命令：

```bash
node scripts/audit/probe-route-module-attribution.mjs   # 逐条打印「路径 -> 归属模块」，均指向 room
grep -c "_rsv(\|_rsi(" src/room-summary/sub-managers/room-event-operation-manager.ts   # 3
```

#### 影响

- `anti_screenshot` / `sticky_events` / `notifications` / `timeline` / `metadata` / `turn_server` / `rendered/` / `fragments/{user_id}` / `translate` / `convert` / `sign` / `verify` / `device` / `event/{id}/url` / `receipts` / `account_data` 这些端点，在契约里**全部归 `room`**，而实现写在 `room-summary`。`room_summary` 的 route-table 里没有它们 → 代码改用裸字面量。
- 后果：后端若改动这些路由，该文件**不会**编译失败，只会在运行时 404。这与 `RoomManagerExtensions.ts`（§13.8）是**同一类病**，只是没有到「不可达」那么严重 —— 它有真实调用方，只是失去了契约保护。

#### 处置（建议，需与测试方案一并实施）

不在本轮动手重构，理由：该文件已由 `scripts/quality/coverage-critical-ledger.json` 登记为 **P0（owner: langkebo, deadline: 2026-10-19）**，补测试方案见 `artifacts/room-event-operation-manager-test-plan.md`。路径断言改造应与补测试**同批**进行：

1. 从 `src/room/__generated__/route-table.ts` 导入 `RoomPathPattern`，在文件内定义 `_rrv()` 断言（与 `e2ee/index.ts` 的 `ep()` 同构）；
2. ~~把 `encodeUri("/rooms/$roomId/…")` 的调用点改写为模板字面量，使字面量类型可被断言识别（`encodeUri` 返回 `string`，会丢失字面量类型，这是当前无法断言的第二个原因）~~ —— **该障碍已解除**（2026-10-06，见 §13.10）：`encodeUri` 已泛型化，返回值保留字面量/模板类型，`encodeUri("/rooms/$roomId/…")` 的字面量可直接断言；
3. 若后端愿意把 `room_summary` 的模块归属补全为「既有 summary 路由 + 其子路由」，则 codegen 会自动覆盖，是更彻底的解法（需后端侧配合）。

> **可迁移的教训**：契约表的**存在**不等于契约保护的**生效**。判据要看「实现文件是否 import 本模块 route-table 并真的用断言」，而不是「目录下有没有 `__generated__/route-table.ts`」。

---

### 13.10 编译期路径校验回归（2026-10-06）：`encodeUri` 泛型化，消除 9 处「失效 `as`」

> 本节记录一项**根因修复**。契约驱动架构承诺「拼错是编译错误」，但 `utils.encodeUri` 返回宽 `string`，调用点只能写 `encodeUri(...) as StripV3<X>` —— 而 `as` 在含模板字面量模式的 union 上**恒过**，等于把校验关掉。§13.9 已把这条列为「无法断言的第二个原因」。

#### 根因

`src/http-api/utils.ts` 原签名 `encodeUri(pathTemplate: string, ...): string`。宽 `string` 无法赋给 `StripV3<XPathPattern>`（模板字面量 union），故调用点被迫 `as`。实测：把 `/user/$userId/account_data/$type` 改成 `.../account_dataX/...`，`as` 版本**tsc 仍 exit=0**。

#### 修复

`src/http-api/utils.ts` 新增 `ReplaceDollarVariables<S>`：按 `/` 分段递归，把 `$var` 段替换为 `${string}`；`encodeUri` 泛型化为 `<P extends string>(pathTemplate: P, ...): ReplaceDollarVariables<P>`。

```ts
type ReplaceDollarVariables<S extends string> = S extends `${infer Head}/${infer Tail}`
    ? `${ReplaceDollarVariables<Head>}/${ReplaceDollarVariables<Tail>}`
    : S extends `${infer Prefix}$${string}`
      ? `${Prefix}${string}`
      : S;
```

要点：`ReplaceDollarVariables<string>` 退化为 `string`（宽 `string` 不匹配模板字面量模式），故 **122/123** 个既有调用点零影响；仅 1 处（`client-batch-requests.ts` 复用 `path + "/$stateKey"`）被泛型化**暴露**出既有的形状不匹配（`/rooms/${s}/state/${s}/${s}` 赋给 `/rooms/${s}/state/${s}`），已显式放宽为 `let path: string` 并注释理由。

#### 效果

- 删除 **9 处**失效 `as StripV3<...>`：`client-account-data-requests.ts`(5)、`room/RoomManager.ts`(3)、`client-batch-requests.ts`(1)。仅 `space/utils.ts:35` 保留（首参为 `.replace()` 表达式，非字面量，泛型化无法覆盖）。
- §13.9 列出的「无法断言的第二个原因」**随之解除**：`encodeUri("/rooms/$roomId/…")` 现在保留字面量类型，可直接断言（room-summary 的整体改造仍待与补测试同批实施）。

#### 验证（可复跑）

| 项       | 命令                                                       | 结果                                                         |
| -------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| 类型     | `npx tsc --noEmit -p tsconfig.json`                        | **exit=0**                                                   |
| 变异自证 | 将 `account_data` 改为 `account_dataX`                     | **TS2345**，错误精确列出 6 个合法 union 成员（证明校验生效） |
| 回归     | 5 个受影响 spec（utils/space/read-receipt/event-timeline） | **150 passed**                                               |
| 格式     | `prettier --check` 4 个改动文件                            | 全绿                                                         |

> **可迁移的教训**：`as T` 当 `T` 含模板字面量模式 union 时**恒过**，是「假断言」。要让契约真正生效，必须让**上游函数返回窄的字面量/模板类型**，而不是在下游贴 `as`。

---

### 13.11 room-summary 路径断言改造（2026-10-06）：30 处恢复编译期校验，暴露 4 处前缀缺陷

> 本节是 §13.9 处置建议的**落地**。§13.9 判定「路径断言改造应与补测试**同批**进行」，补测试（`spec/unit/room-summary/sub-managers/room-event-operation-manager.spec.ts`，58 用例）已先行提交；本次完成断言改造本体。

#### 改动

`src/room-summary/room-summary-base-manager.ts` 原只有一个助手 `roomSummaryPath()`，断言的是 **`room_summary` 契约**（`StripV3<RoomSummaryPathPattern>`）。而 §13.9 已证实：本目录下大量端点在契约里其实归 **`room`** 模块 → 该断言对它们不成立，代码只能退化成裸 `string`。

改造为两个助手 + 一个显式逃生阀：

| 助手                              | 断言对象                                  | 用途                                                                  |
| --------------------------------- | ----------------------------------------- | --------------------------------------------------------------------- |
| `roomSummaryPath()` / `_rsv()`    | `room_summary` 契约                       | 契约里确属 `room_summary` 的端点（`/rooms/$roomId/summary*` 等 3 处） |
| `roomPath()`（**新增**）          | `room` 契约（`StripV3<RoomPathPattern>`） | 物理位置在 room-summary、契约归属 `room` 的端点                       |
| `uncheckedRoomPath()`（**新增**） | 不断言                                    | 显式逃生阀，仅用于下方已知缺陷                                        |

调用点迁移（共 **30** 处，全部从「裸 `string`、无断言」变为编译期校验）：

| 文件                                           | 处数 |
| ---------------------------------------------- | ---- |
| `sub-managers/room-event-operation-manager.ts` | 23   |
| `sub-managers/room-key-manager.ts`             | 5    |
| `sub-managers/room-member-manager.ts`          | 1    |
| `sub-managers/room-search-manager.ts`          | 1    |

#### 暴露的缺陷（转入 `uncheckedRoomPath()` 的 4 处）

`sub-managers/room-invite-policy-manager.ts` 的 `invite_blocklist` / `invite_allowlist`（GET + POST 各 2 处）：

- **契约事实**：这两个端点**只存在于 `/_matrix/vendor/v1`**，归属模块 `invite_blocklist`（见 `docs/api-contract/generated/modules/invite_blocklist.json` 与 `route-manifest.default.json`）；契约中**没有** `/_matrix/client/v3` 版本。
- **实现事实**：本文件用 `requestV3()`（即 `/_matrix/client/v3`，`ClientPrefix.V3`）发出。
- **重复实现**：`src/invite-blocklist/index.ts` 已有一份**前缀正确**（`VendorPrefix`）的实现，本类与之功能重复。

因此这 4 处无法断言 `room` 契约（路径在 `room` 契约里也不存在），只能走逃生阀并在此登记。

#### 处置与遗留

不在本轮直接改前缀：该改动会变更运行时请求路径，且应与 `invite-blocklist` 模块的**去重**一并决策，需后端确认路由归属与废弃计划。当前以 `uncheckedRoomPath()` + 本节登记显式留痕，缺陷关闭后必须改回 `roomPath()` 或 `invite-blocklist` 模块的强类型助手。

#### 验证（可复跑）

| 项         | 命令                                                            | 结果                                                        |
| ---------- | --------------------------------------------------------------- | ----------------------------------------------------------- |
| 类型       | `npx tsc --noEmit`                                              | **exit=0**，但**不能**据此反证路径合法 —— 见 §13.12 勘误    |
| 迁移计数   | `grep -ro "this\.roomPath(" src/room-summary \| wc -l`          | **30**                                                      |
| 逃生阀计数 | `grep -ro "this\.uncheckedRoomPath(" src/room-summary \| wc -l` | **4**（与上文缺陷一一对应）                                 |
| 回归       | `spec/unit/room-summary/**`                                     | 全绿（测试用 `authedRequest` 断言绝对路径，与断言助手解耦） |

> ⚠️ **本节原结论已被 §13.12 证伪**：`StripV3<RoomPathPattern>` 对 `/rooms/**` 命名空间**没有鉴别力**，这 30 处断言「全部通过」不构成任何证据。原文此处写着「反证路径确在 `room` 契约内」，是**错误**的推断，已更正。

> **可迁移的教训**：「物理目录 / 模块归属 / 请求前缀」三者可能同时不一致。修复顺序应是**先让类型系统说不出谎话**（把无法断言的调用点显式标注为逃生阀），再逐个关闭逃生阀 —— 而不是让几十处裸 `string` 静默失去保护。**但前提是断言本身必须真的有鉴别力**：一个恒过的守卫比没有守卫更危险，因为它会让人停止怀疑（本节就是反例）。

---

### 13.12 【勘误·高危】路径模式是「前缀模式」，使契约断言在 `/rooms/**` 等命名空间上退化为恒过（2026-10-06）

> **状态：已修复（2026-10-06）** —— 见 §13.13 的根因修复记录（`PathAssert` 段级精确断言 + 变异自证）。本节保留为**问题陈述与实测证据**，其「处置建议」一节的最初方案（改 `ReplaceBraces` 并全量重生成）**未被采用**，实际手法见 §13.13。

> 本节**推翻 §13.11 的验证结论**，并给出一个影响 **38 个模块中 31 个**的架构级缺陷。

#### 事实（隔离探针，可复现）

在 `src/` 下建临时文件编译（`npx tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler <probe>.ts`）：

```ts
import type { StripV3 } from "./http-api/strip-prefix";
import type { RoomPathPattern } from "./room/__generated__/route-table";
import type { RoomSummaryPathPattern } from "./room-summary/__generated__/route-table";

export const a1: StripV3<RoomPathPattern> = "/rooms/$roomId/capabilities"; // 合法
export const a2: StripV3<RoomPathPattern> = "/rooms/$roomId/invite_blocklist"; // 契约中不存在
export const a3: StripV3<RoomPathPattern> = "/rooms/$roomId/totally_made_up_xyz"; // 编造
export const a4: StripV3<RoomPathPattern> = "/rooms/$roomId/a/b/c/d/e"; // 编造
export const a5: StripV3<RoomPathPattern> = "/definitely/not/in/contract"; // 编造
export const b1: StripV3<RoomSummaryPathPattern> = "/rooms/$roomId/invite_blocklist"; // 对照组
```

| 断言                                      | 预期     | **实测**    |
| ----------------------------------------- | -------- | ----------- |
| `a1` `/rooms/$roomId/capabilities`        | 通过     | 通过 ✅     |
| `a2` `/rooms/$roomId/invite_blocklist`    | **报错** | **通过** ❌ |
| `a3` `/rooms/$roomId/totally_made_up_xyz` | **报错** | **通过** ❌ |
| `a4` `/rooms/$roomId/a/b/c/d/e`           | **报错** | **通过** ❌ |
| `a5` `/definitely/not/in/contract`        | **报错** | 报错 ✅     |
| `b1`（`room_summary` 契约，对照组）       | **报错** | 报错 ✅     |

即：`StripV3<RoomPathPattern>` 对**任何** `/rooms/` 开头的字符串都放行 —— 它只能反证「不以 `/rooms/` 开头且不匹配任何路由」的路径，对 `/rooms/**` **零鉴别力**。

#### 根因

`route-table.ts` 的生成器把契约里的 `{name}` 替换为 `${string}`：

```ts
export type RoomReplaceBraces<P extends string> = P extends `${infer A}{${infer Param}}${infer B}`
    ? `${A}${string}${RoomReplaceBraces<B>}`
    : P;
```

TypeScript 的 `${string}` **可以包含 `/`**。于是契约中「以参数结尾」的路由会生成**前缀模式**：

| 契约路由（真实存在）        | 生成模式                | 后果                              |
| --------------------------- | ----------------------- | --------------------------------- |
| `GET /rooms/{room_id}`      | `/rooms/${string}`      | \*\*吞掉整个 `/rooms/**` 子树\*\* |
| `GET /rooms/{room_id}/keys` | `/rooms/${string}/keys` | 吞掉 `/rooms/*/keys/任意深层路径` |

一般化结论：**生成模式只校验「到该路由最后一个参数为止」的前缀，最后一个参数之后的内容一律不校验。** 当某模块存在较浅的参数结尾路由（room 的 `GET /rooms/{room_id}` 就是），该命名空间下所有断言全部失效。

#### 影响面（量化）

「参数结尾」路由数 / 该模块路由总数（前者越接近后者、或层级越浅，鉴别力越差）：

| 模块         | 参数结尾/总路由 | 模块               | 参数结尾/总路由 |
| ------------ | --------------- | ------------------ | --------------- |
| `key-backup` | **40/66**       | `e2ee`             | 10/38           |
| `room`       | **30/99**       | `account-data`     | 10/15           |
| `media`      | 18/36           | `relations`        | **9/9**         |
| `auth`       | 17/96           | `module`           | 9/23            |
| `friend`     | 15/65           | `external-service` | 9/20            |
| `space`      | 10/48           | `room-summary`     | 4/21            |

全仓 **38 个 route-table 模块中，31 个**存在该类路由；其中 **9 个**属高危（「参数结尾」路由占比 ≥ 50%）——  
也就是说，§13.10/§13.11 所宣称的「拼错是编译错误」在**这些模块里只对路径前缀成立，对尾段不成立**。

#### 对既有结论的影响（勘误）

- **§13.11 作废**：30 处从 `roomSummaryPath`（`room_summary` 契约，**有**鉴别力 —— 见对照 `b1`）迁移到 `roomPath`（`room` 契约，**无**鉴别力）。这次迁移把「会被拦住的断言」换成了「永远通过的断言」。**它不是「恢复编译期校验」，而是「用看起来有守卫的写法替代了真正的守卫」**（改动前是无守卫的裸 `string`，所以不是回归，但宣称的收益是**假的**）。
- **§13.11 的 `uncheckedRoomPath()` 逃生阀论证同样失效**：`invite_blocklist` 的 4 处在 `roomPath` 下**本就能通过**（`a2` 实测放行），并不需要逃生阀。逃生阀保留与否应等 §13.12 的根因修复后重判。
- **§13.10 部分受限**：`encodeUri` 泛型化后，账户数据那处变异（`account_data` → `account_dataX`）仍报 `TS2345`，说明**中段**写错能被抓到；但**尾段**写错（`/user/$userId/account_data/$type/junk`）不会被抓。

#### 处置建议（需决策，属独立改造）

根因在**路径模式的归一化方式**，不在调用点。推荐改为**两侧同构归一 + 精确相等**，即不再依赖 `${string}`：

1. 归一化：把调用点字面量的 `$var` 段与契约的 `{var}` 段**都**替换为单段占位符（如 `{}`），得到「形状」；
2. 断言：要求 `Shape<调用点> extends Shape<契约路由>` 的**精确相等**（双向 `extends`），避免前缀吞噬。

```ts
// 示意：逐段归一，任何以 $ 或 { } 包裹的「整段」都归一为 "{}"
type Seg<S extends string> = S extends `$${string}` ? "{}" : S extends `{${string}}` ? "{}" : S;
type Shape<S extends string> = S extends `${infer A}/${infer B}` ? `${Seg<A>}/${Shape<B>}` : Seg<S>;
```

该方案可正确处理 `/rooms/{room_id}`（形状 `/rooms/{}`）与 `/rooms/$roomId/invite_blocklist`（形状 `/rooms/{}/invite_blocklist`）—— 后者**会被正确拒绝**。

> 该改动落在 `scripts/sdk-contract-codegen.mjs`（生成 `ReplaceBraces` 处）并需重新生成全部 `__generated__/route-table.ts`，**属于独立改造**，须单独授权后实施。实施时预期会暴露出此前被掩盖的真实路径偏差（正是本缺陷的「价值」）。

> **可迁移的教训**：用一个「更宽的类型」去表达「参数占位」时，必须验证它**不会比原模式更宽**。`${string}` 在模板字面量里是「任意字符串（含 `/`）」，不是「一个路径段」。**断言的价值等于它的鉴别力，而不是它的存在** —— 任何新增的编译期守卫都必须配一条「变异自证」（写一个必然非法的值，确认它真的报错），否则无法区分「守卫有效」与「守卫恒过」。

---

### 13.13 【已修复】路径断言的段级精确化（`PathAssert`）与变异自证（2026-10-06）

> 本节是 §13.12 的**根因修复记录**。核心修复**未**改动 `scripts/sdk-contract-codegen.mjs` 的 `ReplaceBraces`、未引入 `${string}` 通配，而是新增**旁路断言助手** `PathAssert`（段级精确匹配）。理由见下。
>
> **后续补正（2026-10-06，见 §13.14）**：为关闭本缺陷暴露出的真实契约归属缺口，又做了两处 codegen 侧补正——① 在 `scripts/contract-module-map.mjs` 加 `assembly → auth` 映射（`auth` 表的 96 条中本就有 90 条是 assembly 路由，属把既有事实显式化）；② 把 `moderation` 从 codegen 的 `SKIP_ROUTE_TABLE_MODULES` 移除，生成其缺失的 `route-table.ts`。两者**仅按 ledger 补齐既有事实、不改变断言机制**，未破坏「零手改生成物」原则（都由生成器产出）。

#### 实际手法

在 `src/http-api/strip-prefix.ts` 新增段级比较三件套（`PathMatchesRoute` / `MatchesRoute` / `PathAssert`）：

```ts
/** 契约侧占位 segment（如 `{room_id}`）——接受调用点的任意单段。 */
type IsPlaceholder<S extends string> = S extends `{${string}}` ? true : false;

/** 双向 `extends` 的精确相等判断（`never` 一律视为不等）。 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export type PathMatchesRoute<
    Call extends string,
    Route extends string,
> = Call extends `${infer CallHead}/${infer CallTail}`
    ? Route extends `${infer RouteHead}/${infer RouteTail}`
        ? IsPlaceholder<RouteHead> extends true
            ? PathMatchesRoute<CallTail, RouteTail>
            : Exact<CallHead, RouteHead> extends true
              ? PathMatchesRoute<CallTail, RouteTail>
              : false
        : false
    : Route extends `${string}/${string}`
      ? false
      : IsPlaceholder<Route> extends true
        ? true
        : Exact<Call, Route>;

export type MatchesRoute<Call extends string, Routes extends string> = true extends (
    Routes extends string ? PathMatchesRoute<Call, Routes> : false
)
    ? true
    : false;

export type PathAssert<Call extends string, Routes extends string> =
    MatchesRoute<Call, Routes> extends true
        ? unknown
        : {
              readonly __invalidPath: Call;
              readonly __hint: "path does not match any route in this module's contract";
          };
```

实现要点（均为实测踩坑结论）：

1. **按 `/` 切段逐段比较**：契约侧占位段（`{...}`）接受任意**单段**；静态段要求双向 `extends` 的**精确相等**；**段数必须一致**。这是消除 `${string}` 前缀吞噬的关键。
2. **失败态不能用 `never`**：`never extends true` 恒真，会让断言永远通过。必须返回 `true` / `false`，并用 `true extends Results` 判定是否任一契约路由命中。
3. **失败态用「品牌对象」**（带 `__invalidPath` / `__hint`）：报错信息能直接指出非法路径，优于 `never`。
4. **断言助手必须写 `<const P extends string>`**：否则字面量被拓宽为 `string`，断言失效。

调用点以「每模块一个私有 `xp` 助手」的形式接入，形如：

```ts
function tp<const P extends string>(path: P & PathAssert<P, StripV3<TagsPath>>): P {
    return path;
}
```

覆盖 **51 个文件、64 处**断言助手（不含 `src/http-api/strip-prefix.ts` 的类型定义与 `__generated__/**`；含 `room-summary-base-manager.ts` 的 `roomPath` 与 `friend/paths.ts` 的 `friendPath`）。计数口径：`grep -rn 'PathAssert<' src/ | grep -v __generated__` 去掉定义文件即得。（`src/cas/index.ts` 因路径经 `resolvePath` 运行时拼接、无法静态断言，其迁移期遗留的未用助手已移除。）

#### 为什么不用 §13.12 的「归一化 `ReplaceBraces`」方案

- 该方案要改生成器并**重新生成全部 38 个模块**的 `route-table.ts`，会改变公开导出类型（`*PathPattern`）的语义与形态，波及面远超本次改造范围；且 `__generated__/**` **禁止手改**，只能整体重生成。
- 旁路方案以**零生成物改动**取得同等鉴别力（段数 + 静态段精确匹配），且可**逐模块增量接入、随时回退**，风险可控。
- 两方案并不冲突：将来若统一到生成器侧，`PathAssert` 可作为过渡期守卫继续生效，或在生成物补齐后退役。

#### 变异自证（关键）

按 §13.12 教训要求，配「必然非法」的反例以排除「守卫恒过」。该探针已**固化为永久类型级回归守卫** `spec/type-tests/path-assert.type-test.ts`：用 `@ts-expect-error` 标注 7 条反例（如 `/rooms/$roomId/invite_blocklist`、多段、`aliasez` 拼错、跨模块冒充 `context`/`report`），受 `pnpm lint:types`（`tsc --noEmit`）强制——一旦断言层失去鉴别力（回退到 `${string}` 或判定方向写反），这些 `@ts-expect-error` 会变成 unused directive（TS2578），CI 即红。正例 9 条全部通过。

| 断言                                                                          | 预期     | 实测（`PathAssert`） |
| ----------------------------------------------------------------------------- | -------- | -------------------- |
| `/rooms/$roomId`、`/rooms/$roomId/members`、`/rooms/$roomId/members/recent`   | 通过     | 通过 ✅              |
| `/rooms/$roomId/account_data/m.room.name`、`/rooms/$roomId/state/m.room.name` | 通过     | 通过 ✅              |
| `/rooms/$roomId/invite_blocklist`（尾段编造，即 §13.12 的 `a2`）              | **报错** | **报错** ✅          |
| `/rooms/$roomId/totally_made_up_xyz`（凭空，`a3`）                            | **报错** | **报错** ✅          |
| `/rooms/$roomId/a/b/c/d/e`（多段，`a4`）                                      | **报错** | **报错** ✅          |
| `/rooms/$roomId/memberz`（**中段**拼错）                                      | **报错** | **报错** ✅          |
| `/definitely/not/in/contract`（非本模块，`a5`）                               | **报错** | **报错** ✅          |

**对照组**（旧模式，证明修复前确实静默放行）：以 `RoomReplaceBraces<StripV3<RoomPath>>` 作约束时，`a2`/`a3`/`a4` 三条非法路径**编译通过** —— 与 §13.12 实测表一致。

门禁证据：`pnpm contract:codegen:check` → `46 supported module helper sets are in sync`；`pnpm lint` 全链路绿（含 `lint:types` / `quality:type-coverage` / `contract-drift` / `manager-extensions`）；`pnpm test` → **406 文件 / 6124 用例全部通过**。

#### 修复后浮现的真实偏差（正是本缺陷的「价值」）—— 已全部收口（2026-10-06）

消除前缀吞噬后，两类此前被掩盖的真实偏差立刻浮现，现已全部闭环：

1. **discovery 3 条房间别名路由的契约归属缺口**（`GET|PUT|DELETE /directory/room/{room_id}/alias[/{room_alias}]`）：后端确实存在（由 `assembly::directory_extra` 注册），但 `assembly` 桶此前未映射到任何 SDK 模块，路由未进任何契约表。
    - **处置（已关闭）**：在 `scripts/contract-module-map.mjs` 加 `assembly → "auth"` 映射（`auth` 表 96 条中本就有 90 条是 assembly 路由，属显式化既有事实），codegen 重生成 `auth` 表至 **110 条**（含这 3 条别名路由 + `/profile/{user_id}/{key_name}` 双段字段路由）。`src/discovery/index.ts` 的 3 处 `uncheckedAp` 逃生阀**已全部改回 `ap`**，`grep -rn uncheckedAp src/` 归零。
    - 性质区分：`path-contract-waivers.json` 的 5 条是「SDK 声明了、后端 ledger 查不到」；本 3 条是「后端有、SDK 契约查不到」——二者方向相反，不能混用豁免。
2. **profile 字段段无法泛型化**（非缺陷，属表达上限）：`/profile/{user_id}/{field}` 的 `field` 段在契约里是 `avatar_url` / `displayname` 两个字面量，`keyof IProfile` 恰好穷尽这二者，三元分支编译期安全。按字面量三元分支构造路径以保留模板字面量类型；将来新增字段需同步分支。已确认非缺陷（见 §13.12「残留边界」）。

#### `uncheckedRoomPath` 逃生阀重判（承接 §13.12 末段）

§13.12 要求「逃生阀保留与否应等根因修复后重判」。结论：**仍需保留，但性质改变**。

- 修复后 `roomPath`（对 `StripV3<RoomPath>`）**已具备鉴别力**。
- `invite_blocklist` 的 4 处调用点归属 `invite_blocklist` 契约（前缀 `/_matrix/vendor/v1`），**不在** `room` 契约内 —— 若改走 `roomPath` 会被**正确地**拒绝，这正是断言的正常工作。
- 故逃生阀从「因断言恒过而**多余**的逃生阀」变为「表达**跨契约归属缺口**的**显式**逃生阀」。关闭条件：把该路由纳入相应 SDK 模块契约表后改回强类型助手。

#### 残留边界（非缺陷，属表达上限）

契约侧占位段（`{room_id}` 等）接受任意**单段**，因此 `/rooms/<任意单段>` 无法与真实 room id 区分。这是「段级结构匹配」的**固有表达上限**（调用点若也含参数段，两侧都是占位段则天然不可区分），而非前缀吞噬。要再进一步需引入参数值域约束，超出契约表当前表达能力。

---

### 13.14 【收口】assembly 契约归属映射 + moderation 表生成 + 逃生阀关闭 + 永久类型级守卫（2026-10-06）

§13.13 暴露的两类真实偏差，连同「moderation 表缺失」一并闭环。

#### 1. `assembly → auth` 契约归属映射（`scripts/contract-module-map.mjs`）

后端 `assembly` 桶（104 条）是核心 router（login/register/versions/capabilities/account/password/**profile**/user_directory…），SDK 的 `auth` 表 96 条中**本就有 90 条是 assembly 路由**——映射关系事实上早已存在，只是未写出。在既有扩展点 `LEDGER_MODULE_TO_SDK_DIR`（ledger 模块名 ≠ SDK 目录名的机制）加一行：

```js
export const LEDGER_MODULE_TO_SDK_DIR = {
    background_update: "background-update",
    msc4108_rendezvous: "rendezvous",
    thirdparty: "third-party",
    assembly: "auth", // 新增：auth 表 90/96 条本就来自 assembly
};
```

codegen 重生成 `src/auth/__generated__/route-table.ts`：**96 → 110 条**（+14，含 `/directory/room/{room_id}/alias[/{room_alias}]` 与 `/profile/{user_id}/{key_name}`），`contract-assertions.ts` 的条目计数同步自动更新（96→110）。

#### 2. `moderation` 缺失表生成（`scripts/sdk-contract-codegen.mjs`）

`moderation.json` 有 7 条路由（含 `POST /rooms/{room_id}/report`），但 `SKIP_ROUTE_TABLE_MODULES` 把它跳过，导致 `src/moderation/__generated__/` 只有 `dto.ts`、`RoomManager` 的 report 调用点无法断言。将其从 skip 移除后 codegen 生成 `route-table.ts`（7 条），`RoomManager` 的 `/rooms/$roomId/report` 改走 `ModerationPath` 断言（`src/room/RoomManager.ts:1082`）；同时把它从 `check-manager-codegen-coverage.mjs` 的 `WAIVED_MODULES` 删除（不再需要 waiver）。`quality:manager-codegen` 覆盖率由 36→**37 covered**。

#### 3. discovery 逃生阀关闭（`src/discovery/index.ts`）

§13.13 暂用的 `uncheckedAp` 逃生阀（3 处房间别名路由）在 assembly→auth 映射后就绪，已全部改回 `ap`，`grep -rn uncheckedAp src/` 归零——discovery 回到 100% 编译期契约断言。

#### 4. 永久类型级回归守卫（`spec/type-tests/path-assert.type-test.ts`）

把 §13.13 的临时探针**固化为永久守卫**：9 条正例 + 7 条 `@ts-expect-error` 反例。受 `pnpm lint:types`（`tsc --noEmit`）强制，置于 `spec/`（`tsconfig.json` 的 `include` 覆盖，但 `tsconfig-build.json` 的 `exclude` 排除，不污染发布产物 `lib/`；文件名不匹配 vitest 的 `*.test.ts`/`*.spec.ts`，不被当作测试采集）。未来任何让 `PathAssert` 失去鉴别力的改动会立刻触发 TS2578。

#### 5. `cas` 模块 NO_CONSUMER 收口（`scripts/quality/check-manager-codegen-coverage.mjs`）

`quality:manager-codegen` 此前长期因 `cas` 红（生成表 17 条、无人 import）。实地核查后的结论：**表不是多余的，消费方式是运行时拼接**——cas 表 17 条中 11 条正是 `CasManager` 实际调用的路由（`/_synapse/admin/v1/cas/*` 服务管理 5 条 + `/_synapse/cas/*` 协议面 6 条），另含规范 SSO 端点 `/_matrix/client/v3/login/sso/redirect/cas` 1 条与 `ROUTE_CONTRACT.md` 遗留 `/admin/*` 5 条；但 `CasManager` 经 `resolvePath` 做**运行时二元前缀拼接**（`synapse_admin` → `"/cas"+basePath` 挂 `/_synapse/admin/v1`；`cas` → `basePath` 挂 `/_synapse/cas`），从不 import route-table 类型 ⇒ 弱证据 NO_CONSUMER。这与 §13.13 记录的「`src/cas/index.ts` 因 `resolvePath` 运行时拼接、无法静态断言」是同一事实。

处置：进 `WAIVED_MODULES`，reason 写明真实原因与核验命令；**不做**「凑一个别名导入洗白成 covered」的处理。迁移条件（ waiver 到期前的独立改造）：把 11 处路径构造点（5 处 `resolvePath` + 5 处字面量 `path:` + 1 处 `getLoginUrl`）改为按分支构造完整字面量路径后，`cp`/`PathAssert` 断言即可生效。定向验证（`classifyModuleCoverage` 探针）：`cas` 无强消费者 → `waived`；反事实（若有强消费者）→ `covered`——waiver 不会掩盖真实覆盖（covered 判定在前）。

#### 6. 验证结果（2026-10-06 实测）

| 门禁 / 验证                                              | 结果                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `npx tsc --noEmit -p tsconfig.json`（含永久守卫）        | **EXIT=0，0 error**                                                                        |
| `pnpm contract:codegen:check`（生成物与 ledger 同步）    | **EXIT=0**，`46 supported module helper sets are in sync`                                  |
| `quality:manager-codegen`                                | **EXIT=0**：37 covered；`cas` 进 waiver（原因可核验），`moderation` 由 waiver 提升 covered |
| ESLint（改动手写文件）                                   | **EXIT=0**，无告警                                                                         |
| prettier（改动文件含本审计文档）                         | 通过（审计文档已 `--write` 修正）                                                          |
| `quality:path-contract`（SDK 字面量路径 vs 后端 ledger） | 本批仅改类型层与 waiver 清单，运行时路径字符串未变，不受影响                               |

#### 遗留观察项（非红、有明确到期）

- `cas` waiver（expires 2026-12-31）：到期前需完成 11 处路径构造点的 PathAssert 迁移，或经复核延长豁免并说明原因。
- `contract:codegen:check` 的「46 sets」口径：本批改动均经 codegen 产出并复跑 `--check` 确认同步，无漂移。

---

### 13.15 【落地】ROUTE_CONTRACT 对账结论的代码收口：10 条真缺口封装 + 3 处口径修正 + 移除 1 条纸面 waiver + admin 面复核与 2 处缺陷修复（2026-10-06）

#### 0. 背景与输入

承接 `artifacts/route-contract-encapsulation-report-2026-10-06.md`：以 `synapse-rust/docs/synapse-rust/ROUTE_CONTRACT.md` 的 **1159 条**路由为全集，逐条做三级证据（路由表类型引用 T1 → 字符串字面量 T2 → 调用点 T3）核查，识别 **165 条「未封装」**。

但报告是基于**静态路径字面量匹配**的，对「别名 / 已废弃旧路径 / helper 中转 / 运行时插值 / 泛型」天然不敏感。因此本轮把这 165 条**逐条回源码取证**，判定口径与分类账见 `artifacts/sdk-encapsulation-completion-plan-2026-10-06.md`，落地计划为 B1–B4。

**换算关系（两个口径，勿混）**：报告 165 = 服务端/内部面 42 + 根级遗留 8 + admin 35 + 客户端面 80；其中客户端面 80 = 真缺口 46 + 工具盲区假阳性 10 + 运行时版本族 15 + 尾斜杠孪生 1 + 浏览器流 8。本轮把「真缺口 46」逐条复核，**其中 36 条实为别名 / 已废弃旧路径 / 已实现的稳定版变体**，真正缺口收敛为 **10 条**。自洽分解：**10 应封装 + 155 不应封装 = 45（别名/旧路径/孪生/浏览器流）+ 25（工具盲区误报）+ 50（架构排除）+ 35（admin 单列）**。

#### 1. 判定口径（四问，全「是」才判应封装）

| 编号              | 问题                                                    | 取证方式                                                                     |
| ----------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **G1 无别名**     | 同一能力后端是否只注册这一条路径（无 legacy 别名/孪生） | 在 ROUTE_CONTRACT 全量路径里搜「同能力不同路径」                             |
| **G2 无替代**     | SDK 现有方法中是否已覆盖该能力                          | Grep 全 `src/`（用**专用检索工具**；裸 grep 的 `\|` 在 toybox 下静默返回空） |
| **G3 客户端面**   | 路径是否在 `/_matrix/client/**` 且非 admin/S2S/AS       | 路径前缀 + `registered_by`                                                   |
| **G4 有产品价值** | 是否有真实调用场景                                      | 后端 handler 语义 + 项目业务（多端交付）                                     |

#### 2. 落地清单（10 条，B1–B4）

| 批次 | 模块                                                | 方法                                                                                        | 端点                                                                                            | 契约断言                                                                                  |                                          |
| ---- | --------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------- |
| B1   | `src/notifications/index.ts`                        | `getPushDevices` / `registerPushDevice` / `unregisterPushDevice` / `sendPushNotification`   | \`GET                                                                                           | POST /\_matrix/client/v3/push/devices`、`DELETE …/push/devices/{id}`、`POST …/push/send\` | `StripV3<PushPath \| NotificationsPath>` |
| B2   | `src/turn-server/index.ts`                          | `getVoipConfig` / `getGuestTurnServerConfig`（并回填既有 `getTurnServerConfig` 的裸字面量） | `GET …/v3/voip/config`、`GET …/v3/voip/turnServer/guest`                                        | `StripV3<AuthPath>`                                                                       |                                          |
| B3   | `src/room-summary/sub-managers/room-key-manager.ts` | `getRoomKeys`                                                                               | `GET …/v3/rooms/{room_id}/keys`                                                                 | 既有 `_rsv`（`StripV3<RoomSummaryPath>`）                                                 |                                          |
| B4   | `src/room/RoomManager.ts`                           | `getUserRooms` / `getMutualRooms` / `createPrivateRoom`                                     | `GET …/v3/user/{user_id}/rooms`、`GET …/v1/user/mutual_rooms`、`POST …/v3/rooms/create_private` | 既有 `rp()`（`RoomManagerPath`）                                                          |                                          |

**结构要点（职责分明）**

1. **B1 的 `np()` 助手由「只断言 `PushPath`」升级为「断言 `PushPath | NotificationsPath`」**——该 manager 同时承担 `push.rs`（`/notifications`）与 `push_notification.rs`（`/push/devices`、`/push/send`）**两个 ledger 模块**；union 与本仓 `RoomManager` 并集多表的既有写法一致。
2. **B2 使 `turn-server` 模块首次进入契约约束**——此前 `path: "/voip/turnServer"` 是**裸字面量**，无任何断言；本轮引入 `vp()` 助手并**回填既有方法**。voip 路由在 ledger 归 `assembly` 模块，本仓已做 `assembly → auth` 映射（§13.14），故断言落在 `AuthPath`，属**跨模块归属**，与 `RoomManager` 引 `SearchPath`/`ModerationPath` 一致。
3. **B3 就近归位**——房间密钥族端点由 `RoomSummaryKeyManager` 统一承担（既有 `keys/claim`、`keys/count`、`keys/version`），新增的裸 `keys` 同族方法**就近放入同一 manager**，未放进 `RoomManager`。
4. **B4 的 `getMutualRooms` 走 v1 稳定租约**——与既有 `ServerCapabilities._unstable_getSharedRooms`（`/uk.half-shot.msc2666/…`）是两个不同租约，后端两者都注册。
5. **B4 在 Room Directory 处补契约注记**——`GET|PUT /rooms/{room_id}/visibility` 是早期版本中被 `/directory/list/room/{roomId}` 取代的**旧路径**，故**有意不实现**，仅记录取舍理由。

#### 3. 纠正对账报告的 3 处粗判

| #   | 报告结论                                                          | 源码取证                                                                                                                                   | 修正                         |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| 1   | `/rooms/{room_id}/visibility`（GET/PUT）为客户端面真缺口（2 条）  | `RoomManager.ts:946/958` 的 `getRoomDirectoryVisibility`/`setRoomDirectoryVisibility` 打的是**规范路径** `/directory/list/room/$roomId`    | 旧路径，**已被取代**，不实现 |
| 2   | 好友 `request/received` 为真缺口（client/v1 + vendor/v1，2 条）   | `friend-request-manager.ts:237-245` 有代码内注释：「后端两个路径都返回 200…现统一使用 route_ledger 规范路径 `/friends/requests/incoming`」 | **别名**，不实现             |
| 3   | MSC4108 `rendezvous/{session_id}` GET/PUT/DELETE 为真缺口（3 条） | `RendezvousManager.getSession/updateSession/deleteSession` 已实现并配 `rp()` 断言                                                          | v1 稳定版**已实现**，是误报  |

另有一类「**有表没人读**」的反向问题：`room_summary` 同族的 3 条与泛型 `send/{event_type}` 4 条属 helper 中转 / 泛型，静态不可归属（见 §3.2 类比）。本轮的通用教训：**报告标签不可直接采信，落地前必须回到源码逐条核验**。

#### 4. 移除 1 条纸面 waiver（`push_notification`）

`scripts/quality/check-manager-codegen-coverage.mjs` 的 `WAIVED_MODULES` 里原有一条 `push_notification` waiver，理由写的是「本表 10 条路由是 push 表（38 条）的**完全子集**（comm -23 无差集），`src/notifications` 消费的是 push 表，无人 import 本表」。

**实测该理由不成立**：

- `notifications` 契约表 **8 条**与 `push` 表 **17 条**，**交集为空**——`/push/devices`、`/push/send` **只存在于 notifications 表**；push 表只含 `notifications/pushers`/`pushrules` 族。
- 也就是说这是一条把「有表没人读」用**错误理由**豁免掉的 **纸面 waiver**。

**处置**：让 `src/notifications/index.ts` **真正消费** `./__generated__/route-table`（即 B1 的 4 个方法），随后**删除该 waiver 条目**，替换为说明性注释（记录「原 waiver 理由不成立」的事实与核验方式）。不采用「凑一个别名 import 洗白成 covered」的做法。

#### 5. 验证结果（2026-10-06 实测）

| 门禁 / 验证                                               | 结果                                                                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `npx tsc --noEmit`（含 `spec/type-tests` 永久守卫）       | **EXIT=0，0 error**                                                                                                  |
| `node scripts/quality/check-manager-codegen-coverage.mjs` | **EXIT=0**：`Covered: 38`（`push_notification` 由 waived 转 **covered**）、`Waived: 10`、`Missing: 0`、覆盖率 100.0% |
| 受影响 spec 全量复跑（5 个文件）                          | **274 passed，EXIT=0**（notifications / turn-server / room-manager / room-summary / room-summary-facade）            |
| prettier（改动手写文件 + 本审计文档 + 梳理文档）          | 通过（均已 `--write`）                                                                                               |
| ESLint（改动文件）                                        | **EXIT=0**（沙箱内会撞 file-broker 超时，改非沙箱执行即可；见「遗留观察项」）                                        |
| admin-media 缺陷修复（§6.3）                              | `npx tsc --noEmit` **EXIT=0**；`spec/unit/admin-extended.spec.ts` **49 passed**（含新增精确路径断言 + 缺参校验）     |

> 注：新增用例覆盖「裸数组/包裹响应容错」「`encodeURIComponent` 编码 device_id」「必填字段校验」「v1 前缀 + 分页查询参数」等边界；`getRoomKeys` 除门面委托外，另有子方法级用例断言真实 HTTP 路径/方法。

#### 6. admin 运维面 35 条的复核：**10 假阳性 + 25 真缺口**，并修复 2 处「路径错」缺陷

对账报告 §4 把 admin 面 **35 条**列为「未封装·需产品决策」。逐条回源码复核后，**其中 10 条是假阳性**（实际已实现），并顺带发现 **2 处真缺陷**——后者性质是「**路径错**」而非「未封装」，是**公开 API 会 404** 的功能性缺陷。

**6.1 假阳性（10 条）—— 又是「prefix 运行时变量」盲区**

| 类                    | 条数 | 取证                                                                                                                                                                                            |
| --------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `external_service.rs` | 5    | `src/external-service/index.ts:149-176` 以 `sap`/`map`/`cp` **带契约断言**实现；`src/external-service/__generated__/route-table.ts:12-16` 本身即声明这些 `/_matrix/admin/v1/external_services*` |
| `cas.rs`              | 5    | `src/cas/index.ts:129-137` 的 `resolvePath("synapse_admin", basePath)` **运行时二元分支**拼出 `/_synapse/admin/v1` + `/cas/services`、`/cas/users/{id}/attributes`；route-table 亦已声明        |

> 值得记一笔的反差：cas 的**契约表**因运行时拼接而「没人读」（§13.14.5 进 waiver），cas 的**路径**又因同一个运行时拼接而「看不见」（被判未封装）。**同一个 `resolvePath` 同时制造了假阴性（表没人读）与假阳性（路径未封装）**。

**6.2 真缺口（25 条）—— 确需产品决策，本轮不实现**

| 子域                   | 条数 | 端点摘要                                                                                                                                                                                                                           |
| ---------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin/media.rs`       | 16   | `/media/delete`、`/media/protect{,\|/{server}}`、`/media/{un,}quarantine/{server}/{id}`、`/media/unprotect`、`/media/quarantine_changes`、`/media/{server}/{id}` GET/DELETE、`/room(s)/{id}/media*`、`/user/{id}/media/quarantine` |
| `push_notification.rs` | 4    | `/push/cleanup`、`/push/config`(GET/PUT)、`/push/process`                                                                                                                                                                          |
| `admin/server.rs`      | 2    | `GET /server`、`GET /rate-limit-status`                                                                                                                                                                                            |
| `admin/room/mod.rs`    | 2    | `POST /rooms/{id}/backfill`、`POST /rooms/{id}/cascade_redact`                                                                                                                                                                     |
| `app_service.rs`       | 1    | `GET /appservices/{as_id}/state/{state_key}`（单 key 变体；SDK 只有无 key 的 `/state`）                                                                                                                                            |

> **门禁粒度上限（值得记录的观察）**：`push_notification` 的 4 条 admin 路由就在 `src/notifications/__generated__/route-table.ts` 内，B1 打通该表消费后，门禁按**模块**判定即显示 `covered` —— 但**这 4 条路由并没有任何方法调用**。`check-manager-codegen-coverage.mjs` 的判定粒度是「模块是否有强消费者」，**不是「每一条路由是否被消费」**，所以它能防「有表没人读」，防不了「表里有幽灵路由」。若要更严，需要新增按路由的消费门禁。

**6.3 修复的 2 处缺陷（`admin-media-manager.ts`）**

| 方法                                  | 原路径（后端**未注册**，调用必 404）   | 修正后                                               |
| ------------------------------------- | -------------------------------------- | ---------------------------------------------------- |
| `AdminMediaManager.quarantineMedia`   | `POST …/media/{media_id}/quarantine`   | `POST …/media/quarantine/{server_name}/{media_id}`   |
| `AdminMediaManager.unquarantineMedia` | `POST …/media/{media_id}/unquarantine` | `POST …/media/unquarantine/{server_name}/{media_id}` |

- **取证方式**：以 `docs/api-contract/generated/route-manifest.all.json`（= 后端 ledger 镜像，1159 条，`mirrorMissing=0`/`mirrorExtra=0` = 零漂移）为 ground truth，逐条比对。后端 `admin/media.rs` **只注册带 `server_name` 段**的 `POST /media/quarantine/{server_name}/{media_id}`；上游 Synapse 早期废弃的 `POST /media/{media_id}/quarantine` 在本后端**不存在**（该路径下只注册了 `GET`/`DELETE /media/{media_id}`，无 `POST`）。
- 这两个方法是 `src/admin/index.ts:517-518` 的**公开 API**，原实现在本后端必然 404。
- **破坏性变更**：签名由 `(mediaId)` 改为 `(serverName, mediaId)`。已同步公开接口声明与单测：新增**精确路径断言**（`toHaveBeenCalledWith("POST", "/media/quarantine/example.org/media123", …)`）+ 缺参校验（`Server name is required` / `Media ID is required`），作为永久回归守卫。

**6.4 顺带核实：SDK 与后端一致的 media 方法（无缺陷）**

`getMedia`(`GET /media`)、`getMediaInfo`(`GET /media/{id}`)、`deleteMedia`(`DELETE /media/{id}`)、`getMediaQuota`(`GET /media/quota`)、`purgeMediaCache`(`POST /purge_media_cache`)、`getMediaQuarantineChanges`(`GET /quarantine_media/{media_id}/changes`)、`getUserMedia`/`deleteUserMedia`(`/users/{id}/media`) —— 路径**均与后端注册一致**。注意 `quarantine_media/{media_id}/changes` 与 `media/quarantine_changes` 是**两条不同的**隔离变更查询端点，前者已封装、后者属上述 16 条真缺口之一。

#### 7. admin 面 25 条真缺口的处置建议，与一簇新发现的「路径对账」缺陷

完整论证见 `artifacts/sdk-admin-gap-recommendation-2026-10-06.md`。要点：

**7.1 25 条的处置（17 做 / 3 不做 / 2 延后 / 1 最低 / 2 不是缺口）**

- **建议做 17 条**，分三批：**A** 媒体运维 9 条（房间媒体查看/隔离/取消隔离/删除、用户媒体隔离、全局隔离增量、保护三件套）→ `admin-media-manager.ts`；**B** 审核刚需 4 条（`cascade_redact`、`backfill`、`GET /server`、`GET /rate-limit-status`）→ `admin-room-manager.ts` / `admin-server-manager.ts`；**C** 推送运维 4 条 → **新建** `admin-push-manager.ts`（不与 `admin-notification-manager` 的 `/server_notices` 混职责）。
- **不做 3 条**：`POST /media/delete` 与 2 条单数旧别名。前者两条判据都不成立——**G5 风险**：`delete_media_by_policy` 不可逆、`before_ts/max_size` 为 `0` 即「不限」，误用可清空全站本地媒体；**G6 语义重复**：后端 `purge_media_cache` 的 handler 注释明写「本实现只有本地媒体，故退化为按访问时间策略删本地媒体」，即既有 `purgeMediaCache` 已是同一能力。后者（`/room/` 单数形态）与 `/rooms/` **共用同一 handler**，属旧别名。
- **延后 2 条**（联邦媒体 `GET`/`DELETE /media/{server_name}/{media_id}`）、**最低优先 1 条**（appservice 单 key state，已有无 key 变体，宜加可选参数而非新增平行方法）。
- **不是缺口 2 条**：`media/quarantine|unquarantine/{server}/{id}` 已被 §13.15.6.3 的修复真实消费，仅因走模板字面量而未被静态检测识别。

**7.2 关键结构决策**：`cascade_redact` 与既有 `redactRoomEvents` **不重复**——后者打 fork 私有路径 `POST /_matrix/client/v3/admin/room/{roomId}/redact`（按时间/条数批量撤回），前者按 **`event_id` 及其关系链**（`m.replace`/`m.relates_to`/`m.in_reply_to`）递归撤回。两者应互相交叉引用 JSDoc。

**7.3 新发现的缺陷簇（性质是「路径错」，非「未封装」，建议单独立项）**

对 `src/**` 中 `adminRequest(Method.X, "<字面量>")` 的调用点加 `AdminPrefix.V1` 前缀后与后端注册面求差（**字面量口径：92 处，为下界**，未含多行/嵌套泛型写法），得：

| 类                     | 条数 | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A 必然 404**（真错） | 6    | `getAdminInfo()`/`getServerInfo()` 打 `/_synapse/admin/v1/info`（后端为**无 v1** 的 `/_synapse/admin/info`，或同前缀的 `/server`）；`cleanupDatabase()` 打 `/cleanup`（后端为 `/cleanup/all\|rooms\|tokens`）；`sendServerNotice()` 字符串分支打 `POST /server_notices`（正解 `POST /send_server_notice`，**同方法另一分支已在用**）；`addFederationBlacklistEntry()` 打 `POST /federation/blacklist`（后端只注册 `/{server_name}` 形态）；`deactivate()` 打 `DELETE /notifications/deactivate`（后端为 `PUT /notifications/{id}/deactivate`，方法与语义均不同） |
| **B 死 fallback**      | 5    | `/server_stats`、`/server_health`、`/server_config`、`/federation/admissions`、`/federation/pending_servers`——主路径正确，fallback 永不命中                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **C 预置未实现**       | 3    | `/backups`、`/presence_routes`、`/rate_limit_callbacks`——后端无此能力，属「超前实现」                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

**7.4 为什么能长期存活（两层原因，缺一不可）**

1. **测试把错误路径固化了**：`spec/unit/admin-new-endpoints.spec.ts:436/444` 断言 `.toBe("/info")`、`spec/unit/admin/sub-managers/admin-notification-manager.spec.ts:140/147` 断言 `DELETE /notifications/deactivate`、`spec/unit/federation.spec.ts:34` 断言 `GET /federation/blacklist`。这类「字面量 vs 字面量」断言只能证明「代码没变」，**证明不了「后端认这个路径」**。
2. **既有门禁 `quality:path-contract` 对 `adminRequest` 简写形态存在抽取盲区**（更根本）。该门禁（`scripts/quality/verify-path-contract.mjs`）的**设计目的与本簇完全一致**——文件头注明它诞生于 2026-09-30 联调的 appservice 下划线缺陷，并写明「该缺陷在 35/35 单测全绿的情况下完全不可见」。但它的两个抽取器只认：**对象形态**（`extractObjectCalls`，正则 `\bmethod:\s*Method\.`，`:183`）与 **`authedRequest<T>(Method.X, "path")`**（`extractPositionalCalls`，正则字面量只含 `authedRequest`，`:226`）——**而 `src/admin/**`的主力写法`this.adminRequest(Method.X, "/path")`（281 处：`adminRequest(`163 +`adminRequest<` 118）两个都不认\*\*。

    实测运行（2026-10-06）：`扫描源文件 460 / 提取请求调用 159 / 匹配成功 155 / 已豁免 4 / 不匹配 0`，并打印「✅ 全部静态请求路径均与后端 ledger 一致」。→ 那句「全部一致」是对 **159 个调用点**下的结论，**admin 面的字面量路径从未进入校验**。**不是「没有门禁」，而是「门禁有洞，且洞的形状恰好等于 admin 面的写法」。**

**7.5 修法（建议顺序：先补门禁 → 再修路径）**

1. `extractPositionalCalls` 的被调方由 `authedRequest` 扩展到 **`adminRequest`**；注意 `adminRequest<{ a: string }>(...)` 的泛型含 `{}`，现用 `[^>]*` 会提前截断，需改为配平扫描。
2. **重跑门禁并确认 6 处 A 类缺陷变红**——这一步同时是门禁的**变异自证**，避免「补了抽取器但没生效」这种新的纸面门禁。
3. 再修 A 类 6 处；B 类死 fallback 顺手清理。
4. **顺手删一条失效豁免**：门禁当前 **`EXIT=1`**，原因不是路径不匹配，而是「未被引用的豁免」`DELETE /_matrix/client/v3/voice/{X}`（后端已补齐）。按豁免表自身规则（「后端补齐后忘记删豁免，会让门禁的失败面被旧条目遮住」）应删除；否则 `quality:contracts` 聚合门禁会保持红色。

**7.6 `GET /server` 与缺陷 A 的汇合点**：`GET /server`（`get_admin_info_compat`）正好是 A 类前两条的正解，且**同前缀**（`/_synapse/admin/v1`），无需改动 prefix 机制——批 B 落地时顺手修复成本最低。唯一注意：该端点限 `super_admin`，普通 `admin` 会 403，需在 JSDoc 写明并保留降级路径。

#### 8. 【落地】按 7.5 的顺序执行：先补门禁盲区（含变异自证），再清理 A 类与死 fallback（2026-10-06）

§7.5 给出的顺序是「**先补门禁 → 再修路径**」，理由是：先修路径的话，修完门禁依然瞎，无法证明「修干净了」。本轮即按此顺序执行。

##### 8.1 门禁改造：`verify-path-contract.mjs` 由「硬编码单包装器」改为「表驱动多包装器」

问题根因（§7.4 第 2 条）是抽取器只认两种写法。修法不是把 `authedRequest` 再复制一份改成 `adminRequest`，而是**把「谁包裹路径」这件事变成一张显式登记表**，否则下一个包装器还会重蹈覆辙。

新增/改造的四个结构性机制：

| 机制                    | 内容                                                                                                 | 解决的问题                                                                                                                                                                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSITIONAL_WRAPPERS`   | 11 个包装器的固定前缀 / 按目录分流 / 「前缀在第 N 个参数」/ 「前缀在 opts 对象里」四种字段           | 替代原来只认 `authedRequest` 的正则；`adminRequest`/`v2Request`/`requestInternal`/`requestV3`/`doRequestV3`/`doRequest`/`requestWithRetry`/`makeRequestWithUIA`/`idServerRequest`/`authedRequest`/`request` 全部纳入                                                         |
| `EXCLUDED_WRAPPERS`     | 3 个显式登记为「不覆盖」：`requestOtherUrl`、`rawJsonRequest`、`sendToDeviceRequest`（各带理由）     | 让**故意不覆盖**与**忘记覆盖**在报告里可区分，避免又留下一个静默黑洞                                                                                                                                                                                                         |
| `OUT_OF_SCOPE_PREFIXES` | `/_matrix/identity/` —— 不属于本 ledger 服务                                                         | 让 `idServerRequest` 的调用不再污染「不匹配」计数                                                                                                                                                                                                                            |
| 配平扫描                | `findTopLevel` / `splitTopLevelArgs` / `skipGenerics` / `splitTopLevelTernary` / `splitTopLevelPlus` | 解决 `adminRequest<{ a: string }>(...)` 泛型含 `{}` 时正则 `[^>]*` 提前截断；以及 `cond ? "/a" : "/b"`、`"/a" + id` 这类**多候选前缀**（任一命中即算匹配），和 `doRequest` 按目录分流（widgets=`/_matrix/client/v1`、space=`/_matrix/client/v3`、worker=`/_synapse/worker`） |

**同时收紧了一条过宽的规则**：原先通配符匹配允许任意「SDK 段 vs 后端 `{占位符}` 段」互相顶替，导致 `/notifications/deactivate`、`/federation/blacklist/add` 被**静默**当作占位符匹配（假阴性）。现收紧为**仅当 SDK 侧具体值含 `.`（域名/事件类型这类明显是数据而非路径段）时可以顶替占位符**，且通配符命中在报告里**单独计数**（本轮 1 处），不再混在「匹配成功」里。

**抽取量的变化**：`159 → 433`（+174%）。旧门禁「扫描 460 文件、提取 159 个调用、报不匹配 0」的正确解读是「**460 个文件里有大量调用从未进入校验**」。

##### 8.2 变异自证（mutation self-proof）：证明新门禁真的会红，而不是又一块纸面门禁

补抽取器最常见的失败模式是「补了但没生效」——报告仍然全绿，因为抽取器实际没抓到东西。故做了一次注入-确认-回退：

1. 在 `src/admin/sub-managers/admin-server-manager.ts` 把已修好的 `"/statistics"` 改回 `"/statisticz"`（仅此一处，其余不动）；
2. **新门禁**（工作区版本）→ **变红，并精确报出 `src/admin/sub-managers/admin-server-manager.ts:83`**；
3. **旧门禁**（`git show HEAD:scripts/quality/verify-path-contract.mjs`，同一份源码）→ 报「不匹配 **0**」，即对同一处缺陷**完全无感**；
4. 回退注入，门禁复绿。

这一步同时证明了两件事：新抽取器**生效**，且旧抽取器的盲区**真实存在**（不是「碰巧没缺陷」，而是「看不见缺陷」）。

##### 8.3 A 类路径修复（8 处，必然 404 → 正解）

| #   | 方法                                                 | 旧（必 404）                                          | 新（后端注册形态）                                 | 依据                                                                                                            |
| --- | ---------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | `AdminServerManager.getAdminInfo`                    | `GET /_synapse/admin/v1/info`                         | `GET /_synapse/admin/info`（改走 `v2Request`）     | 后端注册在 `/_synapse/admin` 根下，**无 `v1` 段**                                                               |
| 2   | `AdminServerManager.getServerInfo`                   | 同上（另有 `/server_info` 死 fallback）               | 同上                                               | 同上                                                                                                            |
| 3   | `AdminServerManager.cleanupDatabase`                 | `POST /cleanup`                                       | `POST /cleanup/all`                                | 后端只有 `/cleanup/all\|rooms\|tokens`；本方法语义为全量，故取 `all`；顺带补 `min_age_ms`（后端唯一消费的字段） |
| 4   | `AdminServerManager.sendServerNotice`（字符串分支）  | `POST /server_notices`                                | `POST /send_server_notice`                         | 同方法的**对象分支**早已在用正解，两分支应汇合                                                                  |
| 5   | `AdminFederationManager.addFederationBlacklistEntry` | `POST /federation/blacklist`（`server_name` 放 body） | `POST /federation/blacklist/{server_name}`         | 后端只注册带 `{server_name}` 段的形态                                                                           |
| 6   | `FederationBlacklistManager.addToBlacklist`          | `POST /federation/blacklist/add`                      | `POST /federation/blacklist/{server_name}`         | 同上（**新发现**，不在 §7.3 的 6 条内）                                                                         |
| 7   | `FederationBlacklistManager.removeFromBlacklist`     | `POST /federation/blacklist/remove`                   | **`DELETE`** `/federation/blacklist/{server_name}` | 同上前提下**方法也错**（**新发现**）                                                                            |
| 8   | `AdminConfigManager.getModuleLogs`                   | `GET /modules/{id}/logs`                              | `GET /modules/logs/{id}`                           | 后端是 `logs` 段在**前**，旧实现两段写反（**新发现**，属「路径段序错」而非「未封装」）                          |

第 6/7/8 条是**补门禁后才暴露**的：它们分别位于 `federation-blacklist-manager.ts` 与 `admin-config-manager.ts`，旧抽取器同样够不着。第 7 条尤其说明「字面量 vs 字面量」的测试有多弱——原测试断言的是 `POST /federation/blacklist/remove`，**方法错、路径错，测试却一直是绿的**。

##### 8.4 B 类死 fallback 清理（8 处）

「主路径正确、404 回退到一条后端从未注册的路径」的分支全部删除。这类分支不会造成线上故障（因为永不命中），但会让代码看起来「有兼容性」、并在真 404 时多一次无意义请求：

`/server_stats`、`/server_health`、`/server_info`、`/server_config`、`/federation/admissions`、`/federation/pending_servers`、`v2Request /v2/users/{id}/devices`（后端设备端点只在 v1 命名空间）、`PUT /registration_tokens/{token}`。

其中后 3 条是**补门禁后新暴露**的（§7.3 的 B 类只列了 5 条）。删除时保留了 `throwOnError` 等**对外语义**（如 `getServerConfig(false)` 仍返回 `{}` 而不抛），只删掉「回退到不存在的路径」这一层。

##### 8.5 测试固化问题：改写 9 条把错误路径钉死的断言

§7.4 第 1 条指出「测试把错误路径固化了」。本轮相应改写：

- `spec/unit/admin-new-endpoints.spec.ts`：7 条由「断言回退会发第二次请求」改为「**断言只发一次 + 404 直接抛**」，并断言新路径；另 1 条 `getModuleLogs` 由只查 query 参数**补强为同时断言 `/modules/logs/mod1`**（原断言对段序错完全无感）。
- `spec/unit/federation.spec.ts`：2 条黑名单用例改为断言 `/federation/blacklist/{server}` 与 `Method.Delete`。
- 断言错误类型由 `MatrixError` 改为 `NotFoundError`——`adminRequest` 会经 `normalizeError` 把 `M_NOT_FOUND` 归一化为 `NotFoundError`，**断言基类会放过归一化本身出错的情况**。

##### 8.6 豁免表重写为 4 类 19 条，并删掉 1 条失效豁免

`path-contract-waivers.json` 原来只有「路径 + 理由」两栏，无法区分「后端没有」与「后端有但语义不同」，导致后者会被误判为「等后端补齐就行」。现分为 4 类（每类都写明**删掉条件**）：

| 类别                | 条数 | 含义                                                                                                                                                               | 删掉条件                                     |
| ------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| `backend-missing`   | 10   | 后端确实没有该端点                                                                                                                                                 | 后端补上该路由                               |
| `semantic-mismatch` | 6    | 后端有邻近端点但**语义不同**（如 `invite/blocklist` 的**整表替换** vs SDK 的**逐条增删**、`notifications/deactivate` 的 `DELETE` vs 后端 `PUT …/{id}/deactivate`） | 产品决策：对齐后端 / 改造 SDK API / 移除方法 |
| `by-design`         | 1    | 后端**有意不实现**（`/backups`，后端有测试 `backups_route_not_in_manifest` 固定该决策）                                                                            | 产品改变该决策                               |
| `other-homeserver`  | 2    | 兼容其他 homeserver / 协议变体                                                                                                                                     | 本后端纳入范畴时                             |

**顺手删除 1 条失效豁免** `DELETE /_matrix/client/v3/voice/{X}`——后端已补齐（`/voice/{media_id}` **只有 GET**，故 SDK 的 DELETE 语义无对应端点，原豁免的存在理由是「后端将补」）。按豁免表自身规则，未引用的豁免会让门禁的失败面被旧条目遮住（该条正是门禁从 `EXIT=1` 变红的原因），必须删。

##### 8.7 已知盲区上限（本轮不再扩张，明确记录）

门禁仍有**一层**未覆盖：`path: helper(...)` 形态——即路径由 helper 函数拼装（`rp` / `friendPath` / `pp` / `ap` / `kb` / `vp` 等 **22 个 helper**，约 **250 处**）。这类需要**过程间分析**（追进 helper 实现），已超出「静态路径字面量对账」的边界。记录在此，避免后人误以为「门禁全绿 = 全仓无路径缺陷」。

##### 8.8 验证结果（2026-10-06 实测）

- `quality:path-contract`：**`EXIT=0`** —— `扫描 460 / 提取 433 / 匹配 414（含通配符 1）/ 豁免 19 / 不匹配 0 / 豁免过期 0 / 豁免未引用 0 / 动态跳过 49 / 域外 7`；「覆盖的包装器 11 / 未覆盖 3」。
- `tsc --noEmit`：`EXIT=0`。
- 受影响的 11 个 spec 文件 **342 个用例全绿**（`spec/unit/admin-new-endpoints.spec.ts`、`spec/unit/federation.spec.ts`、`spec/unit/module-manager.spec.ts`、`spec/unit/admin.spec.ts`、`spec/unit/admin/**`）。
- `quality:swallow-fallbacks`：**`EXIT=0`**（`current 64 / baseline 64 / matched 64 / stale 0 / new 0`）。
    - ⚠️ **该门禁在本次改动前即为红色（既有问题，与 A 类修复无关）**：`src/discovery/index.ts:250` 的 baseline 条目漂移，而该文件本轮**未被改动**。已用 `git worktree add /tmp/wt-head-swallow HEAD` 在 HEAD 上复现确认（HEAD 上仅此 1 条 STALE）。
    - 本次改动另使 5 条 admin 侧条目因**删除代码导致行号漂移**（`admin-federation-manager.ts` 112→119；`admin-user-manager.ts` 416→405 / 438→427 / 465→454 / 502→491）。因 `id = file:line:hash` 含行号，须重记。
    - 用 `--update-baseline` 重记后 diff 复核为 **13 增 13 删、条目数 64→64 不变**，全部是 `id`/`line`/`generatedAt` 的价值变更，**snippet 与 whitelist 一字未动**——即「同一批站点换行号」，**没有借机放行任何新缺陷、也没有悄悄退役任何站点**。
- `quality:debt-markers`：`EXIT=0`（0 新增）。`quality:contract-drift`：`EXIT=0`。`quality:gate-reachability`：`EXIT=0`（可达 44 / 死门禁 0）。`quality:waiver-expiry`：`EXIT=0`（19 valid / 0 expiring / 0 expired）。
- prettier：改动文件全部通过（`verify-path-contract.mjs` 与 `admin-new-endpoints.spec.ts` 先 `--write` 后复检通过）。
- ESLint：**`EXIT=0`**（8 个改动文件）。⚠️ 沙箱内无法完成（见下方「遗留观察项」）；此处是**非沙箱**下的确定结果。

#### 遗留观察项（§13.15.7 / §13.15.8）

- **ESLint 在沙箱内无法完成，但已取得非沙箱确定结果**：`npx eslint <8 个改动文件>` 在沙箱内反复以 `Error: Broker request timed out`（`broker-ipc-client.cjs`）中止（`EXIT=2`）—— 是 WorkBuddy CLI 的 file-broker IPC 超时，**非 lint 报错**。**逐文件**跑时第 1 个文件（`admin-server-manager.ts`）可通过（`EXIT=0`），第 2 个起即挂住（后台运行 12 分钟无输出）。**已在非沙箱下对全部 8 个文件一次性复跑，`EXIT=0`** —— 即本轮改动无 ESLint 违规。同批 `tsc --noEmit`（`EXIT=0`）与 prettier（通过）已覆盖类型与格式。
- **`scripts/**`不在`lint:js`作用域内**：项目口径是`eslint src spec perf`（见 `package.json`的`lint:js`），`scripts/quality/\*.mjs`不在其列；直接对其跑 eslint 会得到`one-var`/`camelcase`/`no-console` 等**预存**风格报错，与本次改动无关，不要误判为回归。
- **admin 运维面 35 条**保持现状（§4 列为「需产品决策」），本轮未动。
- **§13.15.8 遗留：`path: helper(...)` 盲区**（约 250 处 / 22 个 helper）未覆盖，需过程间分析，本轮明确不扩张（见 §13.15.8.7）。
- **§13.15.8 遗留：「语义分裂」类豁免需产品决策**（6 条 `semantic-mismatch`，见 §13.15.8.6）。这类**不能靠改路径解决**——典型是 `invite/blocklist`：后端是**整表替换**语义，SDK 暴露的是**逐条增删**。继续按「等后端补」处理会永久挂着。

---

**审计文档最后更新**: 2026-10-06  
**最近提交**: `859a44771` (assembly→auth 映射) → `81c4da6e6` (discovery 逃生阀关闭) → `9e2d7314f` (永久类型级守卫) → `5176b3f09` (§13.13/§13.14) → cas 收口（见 §13.14.5） → `c1e304dc4` (B1 notifications：push/devices×3 + push/send + 移纸面 waiver) → `42903a4ec` (B2 turn-server：voip/config + turnServer/guest) → `578a00c36` (B3 room-summary：rooms/{id}/keys) → `3d6ffb94e` (B4 room：user/{id}/rooms + mutual_rooms(v1) + create_private) → `52a47a5a2` (fix admin：media quarantine 改 server_name 形态路径) → 本文档与梳理文档（§13.15 正文 + §13.15.6 admin 复核） → 建议文档与本文 §13.15.7（admin 25 条处置建议 + 新发现「路径对账」缺陷簇 + `quality:path-contract` 的 `adminRequest` 抽取盲区） → 本文 §13.15.8 与其对应实现（门禁补抽取盲区含变异自证 + A 类 8 处路径修复 + B 类 8 处死 fallback 清理 + 豁免表 4 分类 19 条 + 9 条测试改写 + swallow 基线重记）  
**核心结论**: Federation 管理 API 完整（剩余 12% 为 S2S 协议）；联调发现并修复 appservice 路径契约缺陷（14 处）；豁免表精简至 6 条真实缺口。**Room 模块的「100%」已作废**（见 §13.8），当前实现面覆盖以 `artifacts/sdk-contract-gap-report.md` 为准。**`quality:path-contract` 的抽取面已由 159 扩到 433**（§13.15.8），「全绿」的含义随之变强；但仍不含 `path: helper(...)` 的约 250 处（§13.15.8.7）  
**勘误**: 见 §13.8（Room 伪覆盖）、§13.9（room-summary 契约归属断裂）、§13.10（`encodeUri` 泛型化，解除前者的第二个阻塞原因）、§13.11（room-summary 断言改造落地 + 暴露 `invite_blocklist` 前缀缺陷）、**§13.12（高危：路径模式是前缀模式，致 §13.11 的断言在 `/rooms/**` 上恒过，38 个模块中 31 个受影响）** 与 **§13.13（已修复：`PathAssert`段级精确断言 + 永久类型级守卫）** 与 **§13.14（收口：assembly→auth 映射 + moderation 表生成 + discovery 逃生阀关闭；discovery 契约归属缺口与 profile 字段段问题均已闭环）** 与 **§13.15（落地：把 ROUTE_CONTRACT 对账结论写回代码——10 条真缺口封装为 B1–B4 + 纠正报告 3 处粗判 + 移除 1 条纸面 waiver `push_notification`；admin 面 35 条复核为 10 假阳性 + 25 真缺口，并修复 media quarantine 的 2 处「路径错」缺陷）** 与 **§13.15.8（已落地：`quality:path-contract` 抽取盲区补齐——旧门禁只认 2 种写法（`extractPositionalCalls`硬编码`authedRequest`），`adminRequest`等 11 个包装器（仅`this.adminRequest(`160 处 +`this.adminRequest<`107 处 = **267 处调用点**）从未进入校验；改为表驱动`POSITIONAL_WRAPPERS` 后抽取量 159→433，并以变异自证证明新旧门禁对同一注入缺陷「一红一绿」；据此修掉 A 类 8 处必然 404 与 B 类 8 处死 fallback，豁免表按 4 类重写为 19 条）\*\*
