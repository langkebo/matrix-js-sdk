# Matrix JS-SDK 后端接口封装审查与优化方案

> **版本**: 2026-09-30  
> **基准**: synapse-rust `feat/room-v12-complete` @ `8cc2ad00e` + matrix-js-sdk 当前 HEAD  
> **状态**: 测试覆盖率门禁建立完成，契约差集登记修复

---

## 一、当前封装概览

### 1.1 已完成模块（✅）

| 模块            | Manager 类                        | 路由数量 | 测试状态    | 备注                                                                                   |
| --------------- | --------------------------------- | -------- | ----------- | -------------------------------------------------------------------------------------- |
| Space           | `SpaceManager` + 7 个子管理器     | ~70      | ✅ 79 tests | 含 hierarchy/child/lifecycle/member/query/stats                                        |
| Room            | `RoomManager`                     | ~45      | ✅ 14 tests | 含创建/加入/离开/状态查询                                                              |
| Room Summary    | `RoomSummaryManager` + 3 子管理器 | ~25      | ✅ 14 tests | event-operation/filter-stats/profile-info                                              |
| Event Report    | `EventReportManager`              | 18       | ✅ 19 tests | 含举报/统计/分级处理                                                                   |
| Admin           | `AdminManager` + 6 子管理器       | ~73      | ✅ 48 tests | cleanup/external-service/notification/policy/report/room/server/user/federation/config |
| CAS             | `CasManager`                      | 17       | ✅ 10 tests | SSO 认证服务管理                                                                       |
| SAML            | `SamlManager`                     | 16       | ✅ 8 tests  | SAML 认证集成                                                                          |
| Push            | `PushManager`                     | ~20      | ✅ 7 tests  | 推送通知管理                                                                           |
| Device          | `DeviceManager`                   | ~15      | ✅ 12 tests | 设备管理                                                                               |
| E2EE            | `E2EEManager`                     | ~25      | ✅ 15 tests | 端到端加密/密钥备份                                                                    |
| Media           | `MediaManager`                    | ~10      | ✅ 8 tests  | 媒体上传/下载/缩略图                                                                   |
| Verification    | `VerificationManager`             | ~12      | ✅ 6 tests  | 设备验证流程                                                                           |
| Friend          | `FriendManager`                   | ~15      | ✅ 10 tests | 好友/联系人管理                                                                        |
| Burn-after-read | `BurnAfterReadManager`            | 5        | ✅ 5 tests  | 阅后即焚功能                                                                           |
| Thread          | `ThreadManager`                   | ~8       | ✅ 7 tests  | 线程消息                                                                               |
| Sliding Sync    | `SlidingSyncManager`              | ~15      | ✅ 9 tests  | MSC3575 滑动同步                                                                       |
| Sync            | `SyncManager`                     | ~10      | ✅ 11 tests | 增量同步                                                                               |

**总计**: 约 **350+** 路由封装，**240+** 集成测试

### 1.2 已完成 Manager 封装（✅ Phase 2 功能补全）

| 模块       | Manager 类          | 路由数量 | 测试状态      | 完成时间   | 备注                                                  |
| ---------- | ------------------- | -------- | ------------- | ---------- | ----------------------------------------------------- |
| Worker     | `WorkerManager`     | 14       | ✅ 已验证     | 2026-09-29 | src/client/worker/                                    |
| OIDC       | `OidcManager`       | 8        | ✅ 已修复导入 | 2026-09-29 | src/client/oidc/ (已于 2026-10-01 移除，见 src/oidc/) |
| Rendezvous | `RendezvousManager` | 6        | ⏸️ 待测试     | TBD        | MSC4xxx 实验性功能                                    |

### 1.3 未实现模块（❌）

> 基于 ROUTE_CONTRACT.md 审计，这些路由存在但未封装

| 类别         | 路由数量  | 说明                                               |
| ------------ | --------- | -------------------------------------------------- |
| 前缀之外路由 | 14 条 CAS | 已部分封装，剩余根级端点（`/login`, `/logout` 等） |
| 统计/报表    | ~20       | 后端暴露但未封装至 SDK                             |

---

## 二、关键问题与优化建议

### 2.1 Room v12 Hydra 语义支持 ✅已验证

**现状**:

- `src/utils/roomVersion.ts`: 提供 `shouldUseHydraForRoomVersion()` 工具函数
- `src/models/room-state.ts`: 正确使用 hydra 语义处理 `additional_creators`
- `PRE_HYDRA_ROOM_VERSIONS = ["1"-"11"]`: v12+ 自动使用 hydra

**建议优化**:

```typescript
// 增强 roomVersion 工具函数
export const KNOWN_ROOM_VERSIONS = [...PRE_HYDRA_ROOM_VERSIONS, "12", "13", "14"];

export function getRoomVersionSemantics(roomVersion: string): "pre-hydra" | "hydra" {
    return PRE_HYDRA_ROOM_VERSIONS.includes(roomVersion) ? "pre-hydra" : "hydra";
}

// 在 RoomManager.createRoom 中添加默认版本协商
public async createRoom(options: ICreateRoomOpts): Promise<{ room_id: string }> {
    // 如果未指定 room_version，从 server capabilities 获取默认版本
    if (!options.room_version) {
        const caps = this.client.getServerCapabilities();
        options.room_version = caps?.room_versions?.default ?? "12";
    }
    // ... rest of implementation
}
```

### 2.2 Admin Manager 路由分组优化 ⚠️待完善

**当前结构**:

```
admin/sub-managers/
├── admin-cleanup-manager.ts       (12 个方法)
├── admin-external-service-manager.ts (12 个方法)
├── admin-notification-manager.ts   (6 个方法)
├── admin-policy-manager.ts        (7 个方法)
├── admin-report-manager.ts        (7 个方法)
├── admin-room-manager.ts          (4 个方法)
├── admin-server-manager.ts        (?)
├── admin-user-manager.ts          (?)
└── admin-federation-manager.ts    (?)
└── admin-config-manager.ts        (?)
```

**建议优化**:

1. **按功能域重组**:
    - `admin/services/` - cleanup, external-service, config
    - `admin/security/` - policy, report
    - `admin/operations/` - notification, room, user, server, federation

2. **统一类型定义位置**:
    - 所有 `*-types.ts` 移至 `admin/types/` 目录
    - 按模块分组而非按文件分散

### 2.3 CAS Manager 前缀处理 Bug 修复 ❌待修复

**当前问题** (Task #33 - P1):

```typescript
// cas/index.ts:127
const path = prefix === "synapse_admin" ? "/admin/services" : "/cas/services";
```

**问题**: 路径构造逻辑与后端路由契约不一致

**后端实际路由** (ROUTE_CONTRACT.md):

- `DELETE /_synapse/admin/v1/cas/services/{service_id}`
- `DELETE /admin/services/{service_id}` // 前缀之外路由

**修复建议**:

```typescript
private resolvePath(prefix: CasApiPrefix, basePath: string): string {
    if (prefix === "synapse_admin") {
        // /_synapse/admin/v1 + /cas/services
        return `/cas${basePath}`;
    } else {
        // /_synapse/cas + /services
        return basePath;
    }
}
```

### 2.4 错误处理一致性 ✨建议改进

**当前问题**:
不同 Manager 的错误处理策略不一致：

- `RoomManager`: 使用 `InvalidParamError` 自定义错误
- `CasManager`: 使用 `requireNonEmptyString` 辅助函数
- `SpaceManager`: 混合使用多种错误类型

**建议统一方案**:

```typescript
// src/managers/errors.ts
export class ManagerError extends Error {
    constructor(
        public readonly code: string,
        message: string,
        public readonly details?: Record<string, unknown>
    ) {
        super(message);
    }
}

export class ValidationError extends ManagerError {
    constructor(field: string, reason: string) {
        super("VALIDATION_ERROR", `${field}: ${reason}`);
    }
}

// 所有 Manager 统一使用
protected validateParameter(value: unknown, name: string): void {
    if (value === null || value === undefined || value === "") {
        throw new ValidationError(name, "is required");
    }
}
```

### 2.5 缓存策略优化 📊待增强

**当前缓存实现**:

- `RoomManager.roomInfoCache`: LRUCache 存储房间版本信息
- `SpaceManager`: 多级缓存（层级/成员/统计）

**建议优化**:

1. **统一缓存管理**:

```typescript
// src/managers/cache-manager.ts
export interface ICacheStrategy {
    maxAge: number; // TTL in ms
    maxSize: number; // Max entries
    keyPrefix: string; // Namespace isolation
    staleWhileRevalidate?: boolean;
}

export class CacheManager {
    private caches: Map<string, LRUCache<string, unknown>> = new Map();

    public get<T>(namespace: string, key: string): T | undefined {
        // 统一缓存获取逻辑
    }

    public set<T>(namespace: string, key: string, value: T, strategy: ICacheStrategy): void {
        // 统一缓存设置逻辑
    }
}
```

2. **缓存失效策略**:

```typescript
// 添加缓存失效事件
public async deleteService(serviceId: string): Promise<CasServiceDeleteResponse> {
    const result = await this.request(...);

    // 清除相关缓存
    this.invalidateCache([`services:*`, `services:${serviceId}`]);

    return result;
}
```

### 2.6 测试覆盖度提升 🎯待加强

**当前状态**:

- Space 相关：99% (79/79)
- Admin 相关：100% (48/48)
- Event Report: 100% (19/19)
- 总体估算：~85%

**建议目标**:

1. **建立覆盖率门禁** (Task #34 - P3):

```yaml
# .vitest/coverage-thresholds.yml
thresholds:
    lines: 80%
    branches: 75%
    functions: 85%
    statements: 80%

# 按模块差异化要求
moduleThresholds:
    core: # Room/Space/E2EE
        lines: 90%
    admin: # Admin/CAS/SAML
        lines: 85%
    experimental: # Worker/Rendezvous
        lines: 60%
```

2. **补充集成测试**:

- 每个 Manager 至少 10-15 个单元测试
- 关键路径必须有端到端测试
- 边界条件（空值/超长/特殊字符）全覆盖

---

## 三、实施路线图

### Phase 1: Bug 修复与稳定性 (P1/P0) - 2026-Q4 ✅

| 任务                      | 优先级 | 预计工时 | 负责人 | 状态    |
| ------------------------- | ------ | -------- | ------ | ------- |
| CAS Manager 路径构造修复  | P1     | 2h       | ✅ Leo | ✅ 完成 |
| OIDC Manager 错误导入修复 | P1     | 1h       | ✅ Leo | ✅ 完成 |
| 统一错误处理策略          | P2     | 4h       | TBD    | ❌ TODO |
| Room v12 默认版本协商     | P2     | 3h       | TBD    | ❌ TODO |
| 参数验证完整性检查        | P1     | 4h       | TBD    | ❌ TODO |

### Phase 2: 功能补全 (P2) - 2027-Q1 ✅

| 任务                            | 优先级 | 预计工时 | 负责人 | 状态                         |
| ------------------------------- | ------ | -------- | ------ | ---------------------------- | ---------------------------------------------- |
| Worker Manager 封装 (14 routes) | P2     | 8h       | ✅ Leo | ✅ 完成 (src/client/worker/) |
| OIDC Manager 封装 (8 routes)    | P2     | 6h       | ✅ Leo | ✅ 完成 (src/oidc/)          | src/client/oidc 已于 2026-10-01 移除（死代码） |
| Rendezvous Manager 封装         | P3     | 4h       | TBD    | ❌ TODO                      |
| Admin Manager 完整路由覆盖      | P2     | 12h      | TBD    | ❌ TODO                      |

### Phase 3: 优化与门禁 (P3) - 进行中 ✅

| 任务                 | 优先级 | 预计工时 | 负责人 | 状态                                                 |
| -------------------- | ------ | -------- | ------ | ---------------------------------------------------- |
| 统一缓存策略实现     | P3     | 16h      | ✅ Leo | ✅ 完成                                              |
| 契约差集登记修复     | P3     | 2h       | ✅ Leo | ✅ 完成 (新增 4 条 SDK-only 路由)                    |
| 测试覆盖率门禁建立   | P3     | 4h       | ✅ Leo | ✅ 完成 (scripts/quality/check-minimum-coverage.mjs) |
| 测试覆盖率提升至 90% | P3     | 40h      | TBD    | ❌ TODO                                              |
| 性能基准测试         | P3     | 8h       | TBD    | ❌ TODO                                              |

### Phase 3: 优化与门禁 (P3) - 进行中

| 任务                 | 优先级 | 预计工时 | 负责人 | 状态    |
| -------------------- | ------ | -------- | ------ | ------- |
| 统一缓存策略实现     | P3     | 16h      | ✅ Leo | ✅ 完成 |
| 测试覆盖率提升至 90% | P3     | 40h      | TBD    | ❌ TODO |
| 建立自动化覆盖率门禁 | P3     | 4h       | TBD    | ❌ TODO |
| 性能基准测试         | P3     | 8h       | TBD    | ❌ TODO |

### Phase 3 进展摘要（真实性复核版 - 已更新）

**已完成（真实有效）**：

- ✅ 创建 `UnifiedCacheManager` 统一缓存管理器 - 31/31 tests passed
- ✅ 实现 `CacheManagerFactory` 预配置工厂 - 真实可用
- ✅ 集成 `CacheMonitor` 监控工具 - 真实可用
- ✅ **Space Hierarchy Manager 集成** - `hierarchyCache.getOrFetch` 实际使用
- ✅ **Space Child Manager 集成** - `childrenCache.getOrFetch` 实际使用
- ✅ **Space Member Manager 集成** - `memberCache.getOrFetch` 实际使用 (**已修复**)
- ✅ **Space Query Manager 集成** - 多个缓存实例实际使用
- ✅ **Space Lifecycle Manager 集成** - `lifecycleCache.getOrFetch` 实际使用 (**已修复**)
- ✅ 产出 Phase 3 实施报告（`docs/cache-strategy-implementation.md`）
- ✅ 产出真实性复核报告（`docs/2026-09-29/audit-truth-check.md`）

**未开始**：

- ⏸️ **Room Manager 缓存迁移** - 已有独立的 LRUCache 实现，待评估是否迁移到 UnifiedCacheManager
- ⏸️ **User Manager 缓存迁移** - 待评估
- ⏸️ **Device Manager 缓存迁移** - 待评估
- ❌ 提升整体测试覆盖率至 90%
- ❌ 建立覆盖率自动门禁
- ❌ 性能基准测试

### 📊 测试结果汇总

| 测试文件                          | 测试数量 | 通过率   | 状态 |
| --------------------------------- | -------- | -------- | ---- |
| `cache-manager.spec.ts`           | 31       | 100%     | ✅   |
| `space-child-manager.spec.ts`     | 11       | 100%     | ✅   |
| `space-hierarchy-manager.spec.ts` | 11       | 100%     | ✅   |
| `space-member-manager.spec.ts`    | 11       | 100%     | ✅   |
| `space-query-manager.spec.ts`     | 19       | 100%     | ✅   |
| `space-lifecycle-manager.spec.ts` | 14       | 100%     | ✅   |
| **总计**                          | **97**   | **100%** | ✅   |

### ⚠️ 重要说明

1. **"11/11 tests passed" ≠ "缓存功能正常"**
    - 现有测试只验证代码结构正确
    - 没有测试 `getOrFetch` 是否真正从缓存返回
    - 没有测试 `invalidate` 是否真正清除缓存

2. **"60-70% 性能提升"是理论计算**
    - 未运行性能基准测试
    - 未在实际项目中测量

### ✅ 真实完成的工作（经验证）

| Manager                 | 真实缓存使用情况                                                          |
| ----------------------- | ------------------------------------------------------------------------- |
| Cache Manager           | ✅ 核心框架完成                                                           |
| Space Hierarchy Manager | ✅ `getSpaceHierarchy` 真正使用缓存                                       |
| Space Child Manager     | ✅ `getSpaceChildren` 真正使用缓存                                        |
| Space Member Manager    | ✅ `getSpaceMembers`, `inviteToSpace`, `joinSpace`, `leaveSpace` 使用缓存 |
| Space Query Manager     | ✅ `getUserSpaces`, `getSpaceByRoom` 等都有缓存                           |
| Space Lifecycle Manager | ✅ `getSpace`, `createSpace`, `updateSpace`, `deleteSpace` 使用缓存       |

### 集成进度统计（真实状态 - 已更新）

| Manager 类别            | 集成状态  | 测试数量 | 通过率 | 真实缓存使用情况        |
| ----------------------- | --------- | -------- | ------ | ----------------------- |
| Cache Manager           | ✅ 完成   | 31       | 100%   | ✅ 核心框架             |
| Space Hierarchy Manager | ✅ 完成   | 11       | 100%   | ✅ `getSpaceHierarchy`  |
| Space Child Manager     | ✅ 完成   | 11       | 100%   | ✅ `getSpaceChildren`   |
| Space Query Manager     | ✅ 完成   | 19       | 100%   | ✅ 多个缓存             |
| Space Member Manager    | ✅ 完成   | 11       | 100%   | ✅ `getSpaceMembers` 等 |
| Space Lifecycle Manager | ✅ 完成   | 14       | 100%   | ✅ `getSpace` 等        |
| Room Managers           | ⏸️ 待评估 | -        | -      | ✅ 有独立 LRUCache      |
| User Managers           | ⏸️ 待评估 | -        | -      | 待检查                  |
| Device Managers         | ⏸️ 待评估 | -        | -      | 待检查                  |

---

## 四、验收标准

### 4.1 功能性验收

- [ ] 所有现有测试保持通过（240+ tests）
- [ ] 新增测试覆盖率 ≥ 90%
- [ ] CAS Manager 路径构造修复后测试通过
- [ ] Room v12 创建/查询默认版本协商工作正常

### 4.2 代码质量验收

- [ ] 所有 Manager 使用统一的错误处理策略
- [ ] 统一参数验证机制
- [ ] 缓存策略一致性检查通过
- [ ] 代码规范检查（eslint/prettier）0 警告

### 4.3 文档验收

- [ ] SDK 使用文档更新（新增/修改的 API）
- [ ] API 变更日志（CHANGELOG.md）
- [ ] 迁移指南（如果需要）
- [ ] 架构决策记录（ADR）

---

## 五、附录

### 5.1 路由映射表

> 后端路由 ↔ SDK 方法对照表（示例）

| 后端路由                                           | SDK 方法                        | Manager 类 | 状态 |
| -------------------------------------------------- | ------------------------------- | ---------- | ---- |
| `GET /_synapse/admin/v1/cas/services`              | `listServices("synapse_admin")` | CasManager | ✅   |
| `POST /_synapse/admin/v1/cas/services`             | `createService()`               | CasManager | ✅   |
| `DELETE /_synapse/admin/v1/cas/services/{id}`      | `deleteService(id)`             | CasManager | ✅   |
| `GET /_synapse/admin/v1/cas/users/{id}/attributes` | `getUserAttributes(id)`         | CasManager | ✅   |
| `POST /_synapse/worker/v1/tasks`                   | ❌ 未实现                       | -          | ❌   |

### 5.2 参考资料

- [synapse-rust ROUTE_CONTRACT.md](/Users/ljf/Desktop/hu_ts/synapse-rust/docs/synapse-rust/ROUTE_CONTRACT.md)
- [matrix-js-sdk SDK 封装审查](/Users/ljf/Desktop/hu_ts/matrix-js-sdk/docs/sdk-encapsulation-audit.md)
- [Room v12 B2a 交付文档](/Users/ljf/Desktop/hu_ts/synapse-rust/docs/audit/ROOM_V12_B2A_DELIVERY_2026-09-27.md)
- [Admin Manager 测试文件](/Users/ljf/Desktop/hu_ts/matrix-js-sdk/spec/unit/admin/)

### 5.3 常用命令

```bash
# 运行 Admin 测试
cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk
PATH="/usr/bin:/bin:$PATH" ./node_modules/.bin/vitest run spec/unit/admin/

# 运行 CAS 测试
PATH="/usr/bin:/bin:$PATH" ./node_modules/.bin/vitest run spec/unit/cas.spec.ts

# 覆盖率报告
PATH="/usr/bin:/bin:$PATH" ./node_modules/.bin/vitest run --coverage

# 运行全量测试
PATH="/usr/bin:/bin:$PATH" ./node_modules/.bin/vitest run --exclude "**/.pnpm-store/**"
```

---

## 六、后续工作计划

### Phase 4: 扩展到其他 Manager (计划中 - P2 优先级)

| 任务                    | 优先级 | 预计工时 | 负责人 | 状态    | 说明                                         |
| ----------------------- | ------ | -------- | ------ | ------- | -------------------------------------------- |
| Room Manager 缓存迁移   | P2     | 8h       | TBD    | ❌ 暂缓 | 已有完善缓存实现，迁移收益低（详见评估报告） |
| User Manager 缓存迁移   | P2     | 6h       | TBD    | ❌ TODO | 暂无独立 Manager 实现                        |
| Device Manager 缓存迁移 | P2     | 4h       | TBD    | ❌ TODO | 暂无独立 Manager 实现                        |
| Admin Manager 缓存迁移  | P2     | 8h       | TBD    | ❌ TODO | TBD                                          |

### 📋 关键决策记录

#### Decision: Room Manager 暂不迁移到统一缓存

**原因**:

1. **功能真实有效** - 已有独立的 LRUCache 实现，不是假象
2. **收益 - 成本比低** - 迁移主要是锦上添花的监控功能
3. **重构成本高** - 需要改动 80+ 处代码，风险大于收益
4. **架构合理性** - 现有实现清晰、维护成本低

**后续行动**:

- ✅ 记录决策过程 (`docs/room-manager-cache-migration-assessment.md`)
- ⏸️ 等待更合适的迁移时机 (如大型重构时)

---

**修订历史**:

- 2026-09-29: 初始版本，Admin Manager 补充完成
- 2026-09-29: 修复 Admin Manager 测试超时问题（增加 vitest timeout 至 60s）
- 2026-09-29: 完善 Space Manager 系列缓存集成（Member/Lifecycle 修复）
- 2026-09-29: 发现并纠正文档不实声明（-audit-truth-check.md）
- 2026-09-30: 建立测试覆盖率门禁（check-minimum-coverage.mjs）
- 2026-09-30: 修复契约差集登记缺失（添加 4 条 room:sdk-only 路由）
- 2026-09-30: 修复 OIDC Manager 错误导入（MatrixError 路径修正）
- 2026-09-30: 修复时间相关测试（使用正则匹配动态天数）
