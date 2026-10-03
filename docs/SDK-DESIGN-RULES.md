# Matrix-JS-SDK 封装与设计规则

> **生效日期**：2026-09-24  
> **适用范围**：matrix-js-sdk 40.2.0-langkebo.5 及后续版本  
> **约束对象**：后端开发团队、SDK 开发团队、前端开发团队（Tjg/HuLa）

---

## 一、核心原则

### 1.1 SDK 封装第一责任

**后端在实现功能时，必须将所有需要与前端交互的部分封装在 SDK 中提供统一接口。**

- ✅ **后端职责**：定义 API 契约 → 在 SDK 中实现完整封装 → 提供类型安全的调用接口
- ❌ **禁止做法**：后端直接暴露原始 HTTP 端点，让前端自行组装请求
- ✅ **例外情况**：仅当该功能明确为"服务端内部接口"（如 Federation、App Service、Admin 运维工具）时可不封装

### 1.2 前端使用缺陷归责

**前端即使暂时未使用 SDK 的某些功能，也应视为前端团队的使用缺陷，由前端团队随后负责优化。**

- ✅ **前端责任**：发现 SDK 已封装但未使用的功能 → 主动改造为 SDK 调用 → 删除重复代码
- ✅ **后端责任**：确保 SDK 封装完整、类型安全、测试充分
- ❌ **禁止做法**：前端绕过 SDK 直接使用 `fetch()`/`axios` 调用后端 API

### 1.3 单一数据源（Single Source of Truth）

**SDK 是前后端交互的唯一权威数据源**

- 所有 API 路径、参数、响应类型必须在 SDK 中统一定义
- 后端路由变更必须同步更新 SDK 的 contract-sync 镜像
- 前端不得维护独立的 API 路径常量或类型定义

---

## 二、SDK 封装范围

### 2.1 必须封装的范围（客户端面）

| 类别                        | 路由前缀                      | 封装要求           | 示例                                  |
| --------------------------- | ----------------------------- | ------------------ | ------------------------------------- |
| **客户端 API**              | `/_matrix/client/v{1,3}/*`    | ✅ 100% 封装       | `/rooms/{id}/send`, `/sync`, `/login` |
| **Vendor API**              | `/_matrix/vendor/v1/*`        | ✅ 100% 封装       | `/friends`, `/voice`                  |
| **MSC 扩展**                | `/_matrix/client/unstable/*`  | ✅ 按 MSC 状态封装 | MSC4155/4156/4204                     |
| **媒体 API**                | `/_matrix/media/{r0,v1,v3}/*` | ✅ 100% 封装       | `/upload`, `/download`                |
| **OIDC/SAML**               | `/_matrix/client/v3/oidc/*`   | ✅ 100% 封装       | `/authorize`, `/token`, `/callback`   |
| **Admin API（客户端可用）** | `/_synapse/admin/v1/*`        | ⚠️ 按需封装        | `/rooms/{id}/redact`, `/event_report` |

### 2.2 可不封装的范围（服务端面）

| 类别                      | 路由前缀                                  | 处置方式  | 理由                                                |
| ------------------------- | ----------------------------------------- | --------- | --------------------------------------------------- |
| **Federation API**        | `/_matrix/federation/v{1,2}/*`            | ❌ 不封装 | 服务端间通信（S2S），客户端通过 Homeserver 间接完成 |
| **App Service**           | `/_matrix/app/v1/*`                       | ❌ 不封装 | 仅在部署 App Service 时有意义                       |
| **Key Exchange**          | `/_matrix/key/v2/*`                       | ❌ 不封装 | 跨服务器密钥交换，服务端间通信                      |
| **Background Updates**    | `/_synapse/admin/v1/background_updates/*` | ❌ 不封装 | 服务端后台维护任务                                  |
| **Admin Audit/Telemetry** | `/_synapse/admin/v1/telemetry/*`          | ❌ 不封装 | 运维/审计场景                                       |

### 2.3 边界判定规则

当不确定某路由是否需要封装时，按以下规则判定：

1. **客户端是否直接发起请求？** → 是 → 必须封装
2. **是否涉及用户交互？** → 是 → 必须封装
3. **是否为服务端内部维护？** → 是 → 可不封装
4. **是否为跨服务器通信？** → 是 → 可不封装

---

## 三、接口设计原则

### 3.1 类型安全优先

**所有 SDK 方法必须提供完整的 TypeScript 类型定义**

```typescript
// ✅ 正确示例
interface SendMessageParams {
    room_id: string;
    event_type: string;
    content: Record<string, unknown>;
    txn_id?: string;
}

interface SendMessageResponse {
    event_id: string;
    content_uri?: string;
}

async function sendMessage(params: SendMessageParams): Promise<SendMessageResponse> {
    // 实现
}

// ❌ 禁止示例
async function sendMessage(roomId: string, content: any): Promise<any> {
    // 避免使用 any 或缺少类型定义
}
```

### 3.2 统一错误处理

**所有 SDK 方法必须使用统一的错误类型**

```typescript
// ✅ 正确示例
import { MatrixError, ErrorCode } from "../errors";

try {
    await sendMessage(params);
} catch (error) {
    if (error instanceof MatrixError) {
        console.error(`Matrix error: ${error.code}`, error.message);
        // 统一处理逻辑
    }
}

// ❌ 禁止示例
try {
    await fetch("/_matrix/client/v3/rooms/...");
} catch (error) {
    // 避免直接捕获原生 Error 或不处理
}
```

### 3.3 路径构造集中化

**所有 API 路径必须在 SDK 中集中定义，禁止在前端硬编码**

```typescript
// ✅ 正确示例 - SDK 侧
// src/room/__generated__/route-table.ts
export const ROOM_SEND_PATH = "/rooms/{room_id}/send/{event_type}";

export function buildRoomSendPath(params: { room_id: string; event_type: string }): string {
    return ROOM_SEND_PATH.replace("{room_id}", encodeURIComponent(params.room_id)).replace(
        "{event_type}",
        encodeURIComponent(params.event_type),
    );
}

// ❌ 禁止示例 - 前端侧
const path = `/rooms/${roomId}/send/${eventType}`; // 不允许！
```

### 3.4 方法命名规范

**SDK 方法命名必须清晰表达业务语义**

```typescript
// ✅ 正确示例
await roomManager.sendMessage(roomId, eventType, content);
await voiceManager.uploadVoice(roomId, audioBlob, duration);
await oidcManager.authenticateWithOIDC(providerId);

// ❌ 禁止示例
await post('/rooms/...'); // 过于底层
await sendMsg(...); // 缩写不清晰
```

### 3.5 文档完整性

**所有公开 API 必须提供完整的 JSDoc 文档**

````typescript
/**
 * 发送消息到指定房间
 *
 * @param roomId - 目标房间 ID（格式：`!roomid:server.name`）
 * @param eventType - 事件类型（如 `m.room.message`）
 * @param content - 事件内容，必须符合 Matrix 事件格式规范
 * @param txnId - 可选的事务 ID，用于幂等性控制
 * @returns 包含 `event_id` 的响应对象
 *
 * @throws {MatrixError} 当房间不存在、无权限或网络错误时抛出
 *
 * @example
 * ```typescript
 * const result = await roomManager.sendMessage(
 *   '!abc123:example.com',
 *   'm.room.message',
 *   { msgtype: 'm.text', body: 'Hello!' }
 * );
 * console.log('Sent event:', result.event_id);
 * ```
 */
async function sendMessage(
    roomId: string,
    eventType: string,
    content: Record<string, unknown>,
    txnId?: string,
): Promise<{ event_id: string }> {
    // ...
}
````

---

## 四、前端使用规范

### 4.1 SDK 调用强制要求

**前端必须优先使用 SDK 提供的封装接口**

```typescript
// ✅ 正确示例 - 使用 SDK
import { RoomManager } from "matrix-js-sdk/src/room";

const roomManager = new RoomManager(client);
await roomManager.sendMessage(roomId, eventType, content);

// ❌ 禁止示例 - 绕过 SDK
import { authedRequest } from "./utils"; // 不允许！
await authedRequest(Method.Post, `/rooms/${roomId}/send`);
```

### 4.2 发现 SDK 未使用时的处理流程

当发现 SDK 已封装但前端未使用时，按以下步骤处理：

```
1. 识别差距
   - 检查 SDK 是否有对应封装（`src/*/index.ts` 或 `__generated__`）
   - 对比后端路由契约（`ROUTE_CONTRACT.md`）

2. 改造现有代码
   - 将直接 HTTP 调用替换为 SDK 方法调用
   - 删除重复的路径构造和类型定义

3. 提交 PR
   - 标题格式：`[refactor] 使用 SDK 封装替换直接 HTTP 调用`
   - 描述中说明改造范围和收益

4. 验证测试
   - 运行相关单元测试
   - 确保功能回归测试通过
```

### 4.3 临时绕过 SDK 的特殊情况

**仅在以下极端情况下允许临时绕过 SDK**：

1. **紧急热修复**：SDK 封装存在严重 Bug，且无法快速修复
    - 必须在 PR 描述中标注 `TODO: 改用 SDK 封装`
    - 创建对应的 Issue 跟踪修复

2. **实验性功能**：尚未稳定的实验性特性（如新 MSC）
    - 必须标注 `@experimental` 标记
    - 在 SDK 中预留封装接口位置

3. **性能优化**：经过性能测试证明 SDK 封装存在瓶颈
    - 必须提供性能对比数据
    - 优先优化 SDK 而非绕过

### 4.4 代码审查检查点

PR 审查时必须检查以下内容：

- [ ] 是否使用了 SDK 提供的封装接口
- [ ] 是否存在重复的路径构造或类型定义
- [ ] 是否正确处理了 SDK 抛出的异常
- [ ] 是否遵循了 SDK 的命名规范和文档要求

---

## 五、后端封装责任

### 5.1 新功能开发流程

**后端实现新功能时，必须按以下流程完成 SDK 封装**：

```
1. 定义 API 契约
   - 在 `ROUTE_CONTRACT.md` 中登记新路由
   - 明确请求/响应类型

2. 实现后端 Handler
   - 编写 Rust 处理器函数
   - 添加单元测试

3. 更新 SDK 镜像
   - 运行 `pnpm contract:sync` 刷新 contract-sync
   - 验证镜像与后端一致

4. 生成 SDK 代码
   - 运行 `pnpm contract:codegen` 自动生成
   - 检查生成的 route-table.ts 和 dto.ts

5. 补充手动封装（如需）
   - 在 `src/*/index.ts` 中补充 Manager 方法
   - 添加 JSDoc 文档

6. 测试验证
   - 运行 `pnpm test:unit` 确保单元测试通过
   - 运行 `pnpm quality:manager-codegen` 确保门禁绿

7. 通知前端
   - 在 PR 描述中标注新增的 SDK 接口
   - 提醒前端团队跟进使用
```

### 5.2 封装完整性检查清单

在 PR 合并前必须确认：

- [ ] 所有客户端面路由已生成 `route-table.ts`
- [ ] 所有 DTO 已生成并带有类型注解
- [ ] 所有 Manager 方法已补充 JSDoc
- [ ] 单元测试覆盖率 ≥ 90%
- [ ] `tsc --noEmit` 通过（零类型错误）
- [ ] `contract-sync --check` 通过（无 gaps）
- [ ] 验收测试通过（如有）

### 5.3 向后兼容性保障

**SDK 变更必须保持向后兼容**：

```typescript
// ✅ 正确示例 - 保持兼容
interface OldParams {
    room_id: string;
    content: Record<string, unknown>;
}

// 新增可选参数，不影响现有调用
interface NewParams extends OldParams {
    txn_id?: string; // 新增可选参数
}

// ✅ 正确示例 - 弃用标记
/**
 * @deprecated 请使用 sendMessageV2()，支持更多特性
 */
async function sendMessage(params: OldParams): Promise<Result> {
    return sendMessageV2(params as NewParams);
}

// ❌ 禁止示例 - 破坏性变更
async function sendMessage(params: { roomId: string }): Promise<Result> {
    // 改变了参数名称或类型
}
```

---

## 六、质量门禁

### 6.1 自动化检查

**以下门禁必须在 CI 中强制执行**：

```yaml
# .github/workflows/quality-gate.yml
jobs:
    sdk-quality:
        runs-on: ubuntu-latest
        steps:
            - name: Contract Sync Check
              run: pnpm contract:sync --check

            - name: TypeScript Type Check
              run: pnpm type-check

            - name: Unit Tests
              run: pnpm test:unit

            - name: Coverage Check
              run: pnpm coverage:check --threshold=90

            - name: Codegen Gate
              run: pnpm quality:manager-codegen
```

### 6.2 前端使用检查

**定期扫描前端代码中的 SDK 使用情况**：

```bash
# 检查是否有绕过 SDK 的直接 HTTP 调用
grep -r "fetch\|axios\|authedRequest" Tjg/src --include='*.ts' \
  | grep -v "node_modules" \
  | grep -v "sdk-contract-codegen" \
  | grep -v "__generated__"

# 检查是否有重复的路径构造
grep -r "/rooms/\|/send/\|/sync" Tjg/src --include='*.ts' \
  | grep -v "node_modules" \
  | grep -v "sdk-contract-codegen"
```

### 6.3 定期审计

**每季度进行一次 SDK 使用审计**：

1. 对比后端路由与 SDK 封装覆盖率
2. 扫描前端代码中的绕过 SDK 调用
3. 识别 SDK 已封装但前端未使用的功能
4. 生成审计报告并分配改进任务

---

## 七、违规处理

### 7.1 后端违规

**后端未按规范封装 SDK 的情况**：

- **轻微违规**（缺少文档、类型不完整）→ PR 驳回，要求补充
- **严重违规**（完全未封装 SDK）→ PR 拒绝，必须先完成封装
- **重复违规**（多次未整改）→ 升级至技术负责人

### 7.2 前端违规

**前端绕过 SDK 直接调用的情况**：

- **首次发现** → PR 标注警告，要求限期整改
- **重复发现** → PR 驳回，必须改用 SDK
- **故意绕过**（无合理理由）→ 升级至前端负责人

### 7.3 豁免申请流程

**特殊情况可申请临时豁免**：

1. 填写豁免申请表（含原因、预期恢复时间）
2. 技术负责人审批
3. 在 PR 中明确标注豁免状态
4. 到期后必须恢复使用 SDK

---

## 八、附录

### 8.1 参考文档

- [ROUTE_CONTRACT.md](../synapse-rust/docs/synapse-rust/ROUTE_CONTRACT.md) - 后端路由契约
- [SDK-AUDIT-REPORT.md](spec/sdk-comprehensive-audit/SDK-AUDIT-REPORT.md) - SDK 审计报告
- [sdk-encapsulation-audit-v2.md](../sdk-encapsulation-audit-v2.md) - 封装审计细则
- [SDK-OPTIMIZATION-SUMMARY.md](../SDK-OPTIMIZATION-SUMMARY.md) - 优化总结报告

### 8.2 常用命令

```bash
# 同步后端路由到 SDK 镜像
pnpm contract:sync

# 生成 SDK 代码
pnpm contract:codegen

# 检查契约一致性
pnpm contract:sync --check

# 运行质量门禁
pnpm quality:manager-codegen

# 检查类型
pnpm type-check

# 运行测试
pnpm test:unit

# 检查覆盖率
pnpm coverage:check
```

### 8.3 变更记录

| 日期       | 版本 | 变更内容     | 负责人   |
| ---------- | ---- | ------------ | -------- |
| 2026-09-24 | v1.0 | 初始版本发布 | SDK 团队 |

---

**本规则自发布之日起生效，所有团队成员必须严格遵守。**
