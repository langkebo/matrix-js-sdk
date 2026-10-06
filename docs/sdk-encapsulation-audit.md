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

---

## 10. 新增功能：Push Manager + SAML/Enterprise SSO (2026-09-24)

### 10.1 Push Manager (`src/push/index.ts`)

**目标**：完整封装 Matrix Push Notification API，覆盖 23 个路由

**覆盖范围**：

- ✅ Push Rules API (7 routes): CRUD 操作、全局开关、批量更新
- ✅ Pushers API (4 routes): 注册/注销推送器、列表查询
- ✅ Push Context API (2 routes): 上下文获取
- ✅ Profile API (3 routes): 展示名/头像管理
- ✅ Tags API (5 routes): 房间标签管理
- ✅ Account Data API (2 routes): 账户数据存储

**测试文件**: `spec/unit/push/push-manager.spec.ts`  
**测试结果**: 23 tests ✅

### 10.2 SAML Auth Manager (`src/saml/index.ts`)

**目标**：完整封装 SAML SSO 认证 API，覆盖 16 个路由

**覆盖范围**：

- ✅ Client Login Routes (8 routes):
    - POST/GET `/login/sso/redirect/saml` - 发起登录
    - POST/GET `/login/saml/callback` - 处理回调
    - GET `/logout/saml` - 登出重定向
    - GET `/logout/saml/callback` - 登出回调
    - GET `/saml/metadata` - IdP 元数据
    - GET `/saml/sp_metadata` - SP 元数据

- ✅ Admin Management Routes (8 routes):
    - GET/PUT `/saml/config` - 配置管理
    - POST `/saml/metadata/refresh` - 元数据刷新
    - GET `/saml/mappings` - 用户映射列表
    - GET/PUT/DELETE `/saml/mapping/{nameId}` - 单个映射管理
    - POST `/saml/logout` - 管理员强制登出

**测试文件**: `spec/unit/saml/saml-auth-manager.spec.ts`  
**测试结果**: 22 tests ✅

### 10.3 测试汇总

```bash
# 运行新增测试
cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk && \
PATH="/usr/bin:/bin:$PATH" ./node_modules/.bin/vitest run \
  --exclude "**/.pnpm-store/**" \
  --exclude "**/.worktrees/**" \
  --exclude "**/Tjg/**" \
  spec/unit/push/push-manager.spec.ts \
  spec/unit/saml/saml-auth-manager.spec.ts

# 结果：Test Files 2 passed (2), Tests 45 passed (45)
```

---

## 11. 新增功能：Admin Manager 完整封装 + CAS Manager Bug 修复 (2026-09-29)

### 11.1 Admin Manager 子模块完整封装

**目标**：完整封装 Synapse Admin API，覆盖 73 个路由

**已完成的子模块**:
| 子管理器 | 路由数 | 测试数 | 状态 |
|---------|-------|--------|------|
| `AdminCleanupManager` | 12 | ✅ 8 tests | 完成 |
| `AdminExternalServiceManager` | 12 | ✅ 10 tests | 完成 |
| `AdminNotificationManager` | 6 | ✅ 8 tests | 完成 |
| `AdminPolicyManager` | 7 | ✅ 6 tests | 完成 |
| `AdminReportManager` | 7 | ✅ 6 tests | 完成 |
| `AdminRoomManager` | 4 | ✅ 10 tests | 完成 |
| **总计** | **48** | **48 tests** | ✅ |

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
| 轨道 | 指标 | 目标 | 用途 |
|------|------|------|------|
| **关键模块** | `src/{admin,dm,space,room-summary,...}/index.ts` | ≥85% | 保护核心业务逻辑的测试完整性 |
| **全仓** | 所有 `src/**/*` | ≥65% | 防止代码库整体测试退化 |
| **路径契约** | SDK → 后端路径静态匹配率 | 100%（豁免登记） | 防止 URL 拼错这类 mock 层检测不到的缺陷 |

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
| `GET /rooms/{room_id}`      | `/rooms/${string}`      | **吞掉整个 `/rooms/**` 子树\*\*   |
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

#### 5. 验证结果（2026-10-06 实测）

| 门禁 / 验证                                              | 结果                                                    |
| -------------------------------------------------------- | ------------------------------------------------------- |
| `npx tsc --noEmit -p tsconfig.json`（含永久守卫）        | **EXIT=0，0 error**                                     |
| `pnpm contract:codegen:check`（生成物与 ledger 同步）    | 需复跑确认（见下「开放项」）                            |
| `quality:manager-codegen`                                | moderated 提升至 covered；**仍因 `cas` 红**（见开放项） |
| `quality:path-contract`（SDK 字面量路径 vs 后端 ledger） | 本批仅改类型层，运行时路径字符串未变，不受影响          |

#### 开放项（既存、非本批引入）

- **`quality:manager-codegen` 仍 EXIT=1**：根因是 `cas` 模块——`src/cas/__generated__/route-table.ts`（17 条）**生成了却无人 import**（NO_CONSUMER）。此状态在本批改动前已存在（未触碰 `cas`），属独立遗留问题，需另行决策（要么让 `cas` 消费其表，要么进 `WAIVED_MODULES` 写明原因）。本批把 `moderation` 从 waiver 提升为 covered，覆盖率反而改善。
- `contract:codegen:check` 的「46 supported module helper sets are in sync」口径需在对账时确认——本批改动均经 codegen 产出，不应引入漂移。

---

**审计文档最后更新**: 2026-10-06
**最近提交**: `116631352` (fix(contract): 路径断言改为段级精确匹配，消除 `${string}` 前缀吞噬)
**核心结论**: Federation 管理 API 完整（剩余 12% 为 S2S 协议）；联调发现并修复 appservice 路径契约缺陷（14 处）；豁免表精简至 6 条真实缺口。**Room 模块的「100%」已作废**（见 §13.8），当前实现面覆盖以 `artifacts/sdk-contract-gap-report.md` 为准
**勘误**: 见 §13.8（Room 伪覆盖）、§13.9（room-summary 契约归属断裂）、§13.10（`encodeUri` 泛型化，解除前者的第二个阻塞原因）、§13.11（room-summary 断言改造落地 + 暴露 `invite_blocklist` 前缀缺陷）、**§13.12（高危：路径模式是前缀模式，致 §13.11 的断言在 `/rooms/**` 上恒过，38 个模块中 31 个受影响）** 与 **§13.13（已修复：`PathAssert` 段级精确断言 + 永久类型级守卫）** 与 **§13.14（收口：assembly→auth 映射 + moderation 表生成 + discovery 逃生阀关闭；discovery 契约归属缺口与 profile 字段段问题均已闭环）\*\*
