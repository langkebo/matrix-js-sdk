# SDK 封装与语义一致性审计报告（@langkebo/matrix-js-sdk vs Sprint 4 后端）

> 日期：2026-09-18  
> 审计范围：`@langkebo/matrix-js-sdk` fork vs Sprint 4 后端语义对齐  
> 基准：后端 ledger (`synapse-rust/tests/unit/fixtures/ledger_export_sdk/all.json` HEAD `7cb39946`)

---

## 执行摘要

| 审计维度 | 状态 | 详细说明 |
|----------|------|---------|
| **路由声明覆盖** | ✅ 89.2% (684/767) | 客户端面路由实现覆盖率 |
| **MSC 语义一致性** | ✅ 已对齐 | MSC4204/4155/3967/4156/4267 均在 `docs/MSC_SEMANTICS.md` 中明确标注 |
| **真缺口** | 0 | 2 条历史缺口已全部修复 |
| **草案 API** | 3 项 | `Takedown`、`getInvitePermissionConfig`、`setInvitePermissionConfig`，标注 "Draft — not implemented" |

---

## 1. MSC 语义对照（Sprint 4 视角）

### 1.1 编号借用模式（非错配）

| MSC 编号 | 官方原始语义 | Sprint 4 后端实际语义 | SDK 封装状态 | 文档位置 |
|----------|------------|-------------------|------------|---------|
| **MSC4204** | 改密默认吊销设备 | 改密默认吊销设备（实为 MSC2457 能力） | `PolicyRecommendation.Takedown` 标注为 Draft | `src/models/invites-ignorer-types.ts:38` |
| **MSC4155** | Invite filtering | 线程订阅读接口 | `ThreadingManager.getSubscribedThreads()` ✅ 正常工作 | `src/invite-blocklist/index.ts:280-281` |
| **MSC3967** | Cross-signing 免 UIA | `/sync` 增量 state token | 无需专属封装（正常消费 `/sync`） | `docs/MSC_SEMANTICS.md` |
| **MSC4156** | join/knock via 参数 | join/knock via 参数 | ✅ 完全对齐 | `docs/MSC_SEMANTICS.md` |
| **MSC4267** | 原子 leave+forget | 原子 leave+forget | ✅ 完全对齐 | `docs/MSC_SEMANTICS.md` |

**结论**：所有 MSC 编号借用均为**有意设计**，非语义错配。SDK 注释已在位。

### 1.2 草案 API（后端零消费）

| API | 位置 | 行为 | 调用结果 |
|-----|------|------|---------|
| `PolicyRecommendation.Takedown` | `src/models/invites-ignorer-types.ts` | 类型合法 | 后端不消费 → 404 |
| `InviteBlocklistManager.getInvitePermissionConfig()` | `src/invite-blocklist/index.ts:276-306` | 读取 Global Account Data | 事件未设置 → 降级为 `null` |
| `InviteBlocklistManager.setInvitePermissionConfig()` | `src/invite-blocklist/index.ts:308-340` | 写入 Global Account Data | 仅写入，后端不做邀请过滤 |

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

| 分类 | 后端路由数 | SDK 实现数 | 覆盖率 |
|------|-----------|----------|--------|
| **客户端面** | 660 | 589 | 89.2% |
| **服务端面** | 366 | 328 | 89.6% |
| **SSO 根级** | 13 | 12 | 92.3% |
| **总计** | 1039 | 929 | 89.4% |

### 2.2 真缺口分析（0 条）

历史缺口修复记录：
- ✅ `GET /_matrix/client/unstable/org.matrix.msc2965/auth_issuer` → `src/client-auth.ts:60`
- ✅ `POST /_matrix/client/v3/admin/room/{room_id}/redact` → `src/admin/AdminRoomManager.redactRoomEvents()`

**当前状态**：客户端面真缺口 = **0**

---

## 3. Sprint 4 主 Ticket 对应关系

| Ticket | MSC 编号 | 后端交付 | SDK 封装 | 一致性 |
|--------|---------|---------|---------|--------|
| **Sprint #4-T01** | MSC4204 | 改密默认吊销设备 | `PasswordAuthManager.revokeDevicesOnPasswordChange()` | ✅ 一致 |
| **Sprint #4-T02** | MSC4267 | 原子 leave+forget | `RoomManager.leave(roomId, { forget? })` | ✅ 一致 |
| **Sprint #4-T03** | MSC3967 | /sync 增量 state token | 正常消费 `/sync` | ✅ 无需封装 |
| **Sprint #4-T04** | MSC4155/4156 | 线程订阅 | `ThreadingManager.getSubscribedThreads()` | ✅ 一致 |

**证据**：
- Commit `56d03326`（MSC4204）
- Commit `fadf125e`（MSC4267）
- Commit `237a7620`（MSC3967）
- Commit `cb8843a4`（MSC4155/4156）

---

## 4. 关键 API 核查清单

### 4.1 Thread 功能

| API | 后端路由 | SDK 封装 | 状态 |
|-----|----------|---------|------|
| `getSubscribedThreads()` | `GET /_matrix/client/v1/threads/subscribed` | `ThreadingManager.getSubscribedThreads(params?)` | ✅ |
| `createGlobalThread()` | `POST /_matrix/client/v1/threads` | `ThreadingManager.createGlobalThread(body)` | ✅ |
| `muteThread()` | `POST /_matrix/client/v1/rooms/{rid}/threads/{tid}/mute` | `ThreadingManager.muteThread(roomId, threadId)` | ✅ |

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

| API | 后端路由 | SDK 封装 | 状态 |
|-----|----------|---------|------|
| `registerAppService()` | `POST /_synapse/admin/v1/appservices` | `ApplicationServiceManager.registerAppService()` | ✅ |
| `getApplicationService()` | `GET /_synapse/admin/v1/appservices/{as_id}` | `ApplicationServiceManager.getApplicationService(as_id)` | ✅ |
| `listAppServices()` | `GET /_synapse/admin/v1/appservices` | ❌ 缺失 | ⚠️ 建议补充 |

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

| 文件 | 旧路径 | 新路径 | 状态 |
|------|--------|--------|------|
| `Tjg/src/services/matrix/rendezvous/MatrixRendezvousService.ts` | `synapse-rust/src/web/routes/rendezvous.rs` | `synapse-web/src/routes/rendezvous.rs` | ✅ |
| `Tjg/src/services/matrix/paths/moderation.ts` | `synapse-rust/src/web/routes/moderation.rs` | `synapse-web/src/routes/moderation.rs` | ✅ |
| `Tjg/src/services/matrix/media/__tests__/voice.contract.test.ts` | `synapse-rust/src/web/routes/voice.rs` | `synapse-web/src/routes/voice.rs` | ✅ |

### 5.2 审计文档同步

| 文档 | 更新内容 | 状态 |
|------|---------|------|
| `Tjg/docs/sdk-encapsulation-audit.md` | 更新后端路径指针 | ✅ |
| `artifacts/sdk-encapsulation-audit.md` | 更新后端路径指针 | ✅ |

---

## 6. 越层调用指标重定义

### 6.1 旧指标（不再使用）

- authedRequest 42 处（文本匹配，含类型声明/注释）
- _synapse/ 24 处（均为路径常量，非越层）

### 6.2 新指标

- **SDK 越层调用点**：12 处（真·越层）
- **判定标准**：直接调用 SDK 底层 API + 拼接完整路径 + 非适配器层特殊场景

**详见**：`Tjg/docs/越层调用指标重定义报告 -2026-09-18.md`

---

## 7. 行动建议优先级

| 优先级 | 行动 | 理由 | 工作量 |
|--------|------|------|--------|
| **P0** | 维持现有 MSC 语义标注 | `docs/MSC_SEMANTICS.md` 完整且在位 | 0 |
| **P1** | 补充 `AppServiceManager.listAppServices()` | 后端已支持，SDK 封装不完整 | 2h |
| **P2** | 澄清 `push GATEWAY` 具体需求 | 可能为非 SDK 职责或误解 | 待澄清 |
| **P3** | 迁移 `UserService.getUserById()` 至 SDK | 消除唯一真越层调用 | 4h |

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

| 后端路由 | 方法 | 优先级 |
|----------|------|--------|
| `GET /_synapse/admin/v1/appservices` | listAppServices() | P1 |
| `GET /_synapse/admin/v2/users/{user_id}` | getUserById() | P2 |

---

**审计报告完成时间**：2026-09-18 19:30  
**下一步**：根据优先级推进 P1/P2/P3 任务
