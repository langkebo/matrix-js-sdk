# SDK 项目现存问题排查报告

> 日期：2026-09-18  
> 方式：对照后端 ledger（`synapse-rust/tests/unit/fixtures/ledger_export_sdk/all.json`）+ SDK 源码扫描  
> 背景：用户提供的 5 项问题清单，逐一核实存在性与修复状态

---

## 排查结论速览

| 问题                              | 状态                | 根因 / 现状                                                                     |
| --------------------------------- | ------------------- | ------------------------------------------------------------------------------- |
| **MSC 语义错配** (4204/4155/3967) | ⚠️ 已理解，非真缺口 | 编号被后端借用承载其他能力；SDK 注释已加"Draft"标注                             |
| **Thread next_batch**             | ✅ 已存在           | `IThreadListResponse` 已定义 `next_batch?: string`                              |
| **mute 抑制功能**                 | 🟢 部分缺失         | 后端有 `/thread/{id}/mute`，SDK 有 `muteThread()`；但无用户级 `/user/{id}/mute` |
| **push GATEWAY**                  | 🔴 后端不存在       | 后端 ledger 中无 `push_gateway` 相关路由                                        |
| **AppService Getter**             | 🟡 缺少 list 方法   | 后端有 `GET /_synapse/admin/v1/appservices`，SDK 只有 `registerAppService`      |

---

## 详细核查

### 1. MSC 语义错配（4204/4155/3967）

**用户描述**：4204/4155/3967 编号语义与后端不一致

**核查结果**：✅ 此问题已被正确理解和记录，**非真缺口**

| MSC 编号    | 官方语义             | 本项目后端实际语义                   | SDK 处理状态                                          |
| ----------- | -------------------- | ------------------------------------ | ----------------------------------------------------- |
| **MSC4204** | 改密默认吊销设备     | 改密默认吊销设备（对应官方 MSC2457） | `PolicyRecommendation.Takedown` 标注为"Draft"         |
| **MSC4155** | Invite filtering     | 线程订阅读接口                       | `ThreadingManager.getSubscribedThreads()` ✅ 正常工作 |
| **MSC3967** | Cross-signing 免 UIA | `/sync` 增量 state token             | 无需专属封装（正常消费 `/sync`）                      |

**证据**：

- `src/invite-blocklist/index.ts:280-281`: "MS C4155 invite filtering, so this read is never served"
- `src/invite-blocklist/index.ts:308`: `setInvitePermissionConfig()` 标注"Draft — not implemented by synapse-rust"
- `docs/MSC_SEMANTICS.md`: 完整记录语义映射关系

**结论**：无需修复，文档已在位

---

### 2. Thread next_batch

**用户描述**：`getSubscribedThreads` 未暴露 `next_batch` 游标

**核查结果**：✅ 已存在

```typescript
// src/thread/index.ts:87
export interface IThreadListResponse {
    threads: IThread[];
    next_batch?: string;  // ← 已定义
}

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

**结论**：功能已实现，无需修复

---

### 3. mute 抑制功能

**用户描述**：`/client/v3/user/{userId}/mute` 相关 API 需 SDK 封装

**核查结果**：🟢 部分缺失

| 功能            | 后端路由                                                           | SDK 封装                                       |
| --------------- | ------------------------------------------------------------------ | ---------------------------------------------- |
| **Thread mute** | `POST /_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/mute` | ✅ `muteThread()`（`src/thread/index.ts:286`） |
| **User mute**   | ❌ 后端无此路由                                                    | ❌ 不存在                                      |
| **Room mute**   | ❌ 后端无此路由                                                    | ✅ PushRuleManager 有 `setRoomMutePushRule()`  |

**证据**：

- 后端 ledger 仅有 `POST /_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/mute`
- SDK `src/thread/index.ts:286-300` 已封装 `muteThread()`
- 用户级 `/user/{user_id}/mute` 路由在后端 ledger 中不存在

**结论**：

- Thread mute：已存在
- User mute：后端不存在该能力

---

### 4. push GATEWAY

**用户描述**：`push_gateway` 字段只写不读，需补齐读能力

**核查结果**：❌ **后端根本不存在 push_gateway 相关路由**

**核查证据**：

```bash
# 后端 ledger 中搜索
python3 -c "
import json
d = json.load(open('/Users/ljf/Desktop/hu_ts/synapse-rust/tests/unit/fixtures/ledger_export_sdk/all.json'))
for e in d['entries']:
    if 'gateway' in e['path'].lower():
        print(e['path'])
# → 无任何输出
```

**推论**：

- 用户可能指的是 Matrix 标准的 `push_gateway` API（`/_matrix/push/v1/notify`）
- 或者是指 pusher 相关 API（`/pushers`），但这些是管理 pusher 而非 gateway

**结论**：需澄清具体指哪个 API，当前后端无 `push_gateway` 路由

---

### 5. AppService Getter

**用户描述**：已补，但需验证 `list_app_services` 等方法

**核查结果**：🟡 缺少 list 方法

**后端能力**（共 21 条 appservice 路由）：

```
GET    /_synapse/admin/v1/appservices              ← 列表
GET    /_synapse/admin/v1/appservices/{as_id}      ← 获取单个
POST   /_synapse/admin/v1/appservices              ← 注册
DELETE /_synapse/admin/v1/appservices/{as_id}      ← 注销
... 更多细粒度操作
```

**SDK 现有封装**（`src/app-service/index.ts`）：

- ✅ `registerAppService()` - 注册
- ✅ `getApplicationService()` - 获取单个
- ❌ `listAppServices()` - 列表（缺失）

**缺失方法**：

```typescript
// 应新增
async listAppServices(filter?: {
    ip_range_whitelist?: string[];
}): Promise<ApplicationService[]>;
```

**结论**：建议补充 `listAppServices()` 方法以对齐后端能力

---

## 行动建议

| 优先级 | 行动                                              | 理由                             |
| ------ | ------------------------------------------------- | -------------------------------- |
| **P1** | 补充 `AppServiceManager.listAppServices()`        | 后端已支持，SDK 封装不完整       |
| **P1** | 澄清 `push GATEWAY` 具体指什么                    | 后端无对应路由，可能是误解或遗漏 |
| **P3** | 如确需用户级 mute，推动后端添加 `/user/{id}/mute` | 后端不存在该能力                 |
| **P0** | MSC 语义文档已在位，无需动作                      | `docs/MSC_SEMANTICS.md` 完整记录 |

---

## 复核命令

```bash
# 1. 验证 MSC 语义文档标注
grep -rn "Draft — not implemented by synapse-rust" /Users/ljf/Desktop/hu_ts/matrix-js-sdk/src

# 2. 验证 next_batch 字段
grep -n "next_batch" /Users/ljf/Desktop/hu_ts/matrix-js-sdk/src/thread/index.ts

# 3. 验证 thread mute 方法
grep -n "muteThread" /Users/ljf/Desktop/hu_ts/matrix-js-sdk/src/thread/index.ts

# 4. 验证 push_gateway 是否存在（预期无输出）
python3 -c "
import json
d = json.load(open('/Users/ljf/Desktop/hu_ts/synapse-rust/tests/unit/fixtures/ledger_export_sdk/all.json'))
for e in d['entries']:
    if 'gateway' in e['path'].lower():
        print(e['path'])

# 5. 验证 appservice 后端路由
python3 -c "
import json
d = json.load(open('/Users/ljf/Desktop/hu_ts/synapse-rust/tests/unit/fixtures/ledger_export_sdk/all.json'))
for e in d['entries']:
    if 'appservice' in e['path'].lower() and 'GET' in e['method']:
        print(f\"{e['method']} {e['path']}\")
```

---

## 更新后的 MSC_SEMANTICS.md 建议

在现有文件中追加以下条目：

```markdown
## 5. 新增能力建议

| 缺失能力                              | 后端路由                             | SDK 状态 | 优先级 |
| ------------------------------------- | ------------------------------------ | -------- | ------ |
| `AppServiceManager.listAppServices()` | `GET /_synapse/admin/v1/appservices` | ❌ 缺失  | P1     |
| `push_gateway` 相关 API               | ❌ 后端无此路由                      | 待澄清   | P1     |

## 6. 已确认不存在的能力

| API                    | 说明                              |
| ---------------------- | --------------------------------- |
| `/user/{user_id}/mute` | 后端 ledger 中不存在该路由        |
| `/push/gateway` 或类似 | Matrix 标准 push_gateway 未被实现 |
```

---

**报告完成时间**：2026-09-18 19:00  
**下一步**：等待用户对 `push GATEWAY` 的具体含义做出澄清，然后决定是否推进
