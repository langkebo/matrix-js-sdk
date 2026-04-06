# Client.ts 重构计划

## 概述

本文档描述了 client.ts 文件的长期重构计划。目标是将 9510 行的单体文件拆分为可维护的模块化结构。

## 当前状态

- **文件大小**: 364KB
- **代码行数**: 9510 行
- **废弃方法**: 31 个
- **主要问题**: 
  - 文件过大，难以维护
  - 与 Manager 模块功能重叠
  - 缺乏清晰的模块边界
  - 构建和类型检查速度慢

## 重构目标

### 短期目标 (v40.x)
- ✅ 标记所有废弃方法
- ✅ 创建迁移指南
- ✅ 保持完全向后兼容

### 中期目标 (v41.0.0)
- 移除废弃方法 (~800 行)
- 提取功能 Mixin 模块
- 创建 ClientCore 基类
- 保持公共 API 兼容

### 长期目标 (v42.0.0+)
- 完全模块化架构
- client.ts 减少到 ~2000 行
- 按需加载优化
- 构建性能提升 30%+

## 架构设计

### 目标架构

```
MatrixClient (2000 行)
├── ClientCore (核心基类)
│   ├── credentials
│   ├── http
│   ├── store
│   └── 基础事件发射
│
├── RoomMixin (1500 行)
│   ├── createRoom()
│   ├── joinRoom()
│   ├── leaveRoom()
│   ├── inviteUser()
│   └── 房间相关方法
│
├── SyncMixin (800 行)
│   ├── startClient()
│   ├── stopClient()
│   ├── sync()
│   └── 同步相关方法
│
├── CryptoMixin (1000 行)
│   ├── initRustCrypto()
│   ├── getCrypto()
│   └── 加密相关方法
│
├── EventMixin (600 行)
│   ├── sendEvent()
│   ├── redactEvent()
│   └── 事件处理方法
│
└── Manager 委托层
    ├── getProfileManager()
    ├── getPresenceManager()
    ├── getDeviceManager()
    └── 其他 Manager
```

### 模块职责划分

#### ClientCore (核心基类)
```typescript
// src/client-core.ts
export abstract class ClientCore extends TypedEventEmitter {
    protected credentials: IMatrixClientCreateOpts;
    protected http: MatrixHttpApi;
    protected store: IStore;
    protected crypto?: CryptoApi;
    
    // 基础方法
    public getUserId(): string | null;
    public getHomeserverUrl(): string;
    public isLoggedIn(): boolean;
    
    // 事件发射基础设施
    protected emit(event: string, ...args: any[]): boolean;
}
```

#### RoomMixin (房间操作)
```typescript
// src/client-mixins/room-mixin.ts
export interface RoomMixin {
    // 房间 CRUD
    createRoom(options: ICreateRoomOpts): Promise<{ room_id: string }>;
    joinRoom(roomIdOrAlias: string, opts?: IJoinRoomOpts): Promise<Room>;
    leaveRoom(roomId: string): Promise<void>;
    
    // 成员管理
    invite(roomId: string, userId: string): Promise<void>;
    kick(roomId: string, userId: string, reason?: string): Promise<void>;
    ban(roomId: string, userId: string, reason?: string): Promise<void>;
    
    // 消息发送
    sendMessage(roomId: string, content: IContent): Promise<ISendEventResponse>;
    sendTextMessage(roomId: string, body: string): Promise<ISendEventResponse>;
    
    // 房间状态
    getRooms(): Room[];
    getRoom(roomId: string): Room | null;
}
```

#### SyncMixin (同步管理)
```typescript
// src/client-mixins/sync-mixin.ts
export interface SyncMixin {
    // 同步控制
    startClient(opts?: IStartClientOpts): Promise<void>;
    stopClient(): void;
    
    // 同步状态
    getSyncState(): SyncState | null;
    getSyncStateData(): ISyncStateData | null;
    
    // 初始同步
    isInitialSyncComplete(): boolean;
}
```

#### CryptoMixin (加密功能)
```typescript
// src/client-mixins/crypto-mixin.ts
export interface CryptoMixin {
    // 加密初始化
    initRustCrypto(): Promise<void>;
    getCrypto(): CryptoApi | undefined;
    
    // 加密状态
    isCryptoEnabled(): boolean;
    isRoomEncrypted(roomId: string): boolean;
    
    // 密钥管理
    exportRoomKeys(): Promise<IMegolmSessionData[]>;
    importRoomKeys(keys: IMegolmSessionData[]): Promise<void>;
}
```

#### EventMixin (事件处理)
```typescript
// src/client-mixins/event-mixin.ts
export interface EventMixin {
    // 事件发送
    sendEvent(roomId: string, eventType: string, content: IContent): Promise<ISendEventResponse>;
    
    // 事件操作
    redactEvent(roomId: string, eventId: string, reason?: string): Promise<ISendEventResponse>;
    
    // 事件查询
    fetchRoomEvent(roomId: string, eventId: string): Promise<IEvent>;
}
```

## 实施阶段

### 阶段 1: 准备工作 (v40.x) ✅ 已完成

**目标**: 为重构做准备，不破坏兼容性

**任务**:
- ✅ 标记 31 个废弃方法
- ✅ 创建迁移指南文档
- ✅ 更新 CHANGELOG
- ✅ 通知用户即将到来的变更

**时间**: 已完成

### 阶段 2: 移除废弃方法 (v41.0.0)

**目标**: 清理废弃代码，减少 ~800 行

**任务**:
1. 移除 Profile 相关废弃方法 (5 个)
2. 移除 Presence 相关废弃方法 (2 个)
3. 移除 Device 相关废弃方法 (7 个)
4. 移除 Push 相关废弃方法 (8 个)
5. 移除 Room Summary 相关废弃方法 (3 个)
6. 更新所有测试
7. 更新文档

**预期结果**:
- client.ts: 9510 行 → ~8700 行
- 所有测试通过
- 文档更新完成

**时间**: 2026 Q3 (6 个月后)

### 阶段 3: 创建 ClientCore 基类 (v41.1.0)

**目标**: 提取核心功能到基类

**任务**:
1. 创建 `src/client-core.ts`
2. 提取核心属性和方法
3. MatrixClient 继承 ClientCore
4. 确保所有测试通过

**预期结果**:
- 新增 client-core.ts (~500 行)
- client.ts: 8700 行 → ~8200 行
- 零破坏性变更

**时间**: 2026 Q4

### 阶段 4: 提取 RoomMixin (v41.2.0)

**目标**: 将房间相关方法提取到独立模块

**任务**:
1. 创建 `src/client-mixins/room-mixin.ts`
2. 提取所有房间相关方法 (~1500 行)
3. MatrixClient 实现 RoomMixin 接口
4. 更新测试

**预期结果**:
- 新增 room-mixin.ts (~1500 行)
- client.ts: 8200 行 → ~6700 行

**时间**: 2027 Q1

### 阶段 5: 提取 SyncMixin (v41.3.0)

**目标**: 将同步相关方法提取到独立模块

**任务**:
1. 创建 `src/client-mixins/sync-mixin.ts`
2. 提取所有同步相关方法 (~800 行)
3. MatrixClient 实现 SyncMixin 接口
4. 更新测试

**预期结果**:
- 新增 sync-mixin.ts (~800 行)
- client.ts: 6700 行 → ~5900 行

**时间**: 2027 Q1

### 阶段 6: 提取 CryptoMixin (v42.0.0)

**目标**: 将加密相关方法提取到独立模块

**任务**:
1. 创建 `src/client-mixins/crypto-mixin.ts`
2. 提取所有加密相关方法 (~1000 行)
3. MatrixClient 实现 CryptoMixin 接口
4. 更新测试

**预期结果**:
- 新增 crypto-mixin.ts (~1000 行)
- client.ts: 5900 行 → ~4900 行

**时间**: 2027 Q2

### 阶段 7: 提取 EventMixin (v42.1.0)

**目标**: 将事件处理方法提取到独立模块

**任务**:
1. 创建 `src/client-mixins/event-mixin.ts`
2. 提取所有事件相关方法 (~600 行)
3. MatrixClient 实现 EventMixin 接口
4. 更新测试

**预期结果**:
- 新增 event-mixin.ts (~600 行)
- client.ts: 4900 行 → ~4300 行

**时间**: 2027 Q2

### 阶段 8: 最终优化 (v42.2.0)

**目标**: 完成重构，达到目标架构

**任务**:
1. 优化剩余代码
2. 移除内部重复逻辑
3. 优化导入和依赖
4. 性能测试和优化

**预期结果**:
- client.ts: 4300 行 → ~2000 行
- 构建时间减少 30%
- 类型检查速度提升
- 完整的模块化架构

**时间**: 2027 Q3

## 风险管理

### 高风险项
1. **破坏向后兼容性**
   - 缓解: 严格遵循语义化版本
   - 缓解: 提供至少 6 个月迁移期
   - 缓解: 详细的迁移指南

2. **引入新 bug**
   - 缓解: 每个阶段完整测试
   - 缓解: 保持测试覆盖率 >70%
   - 缓解: Beta 版本测试

3. **用户迁移困难**
   - 缓解: 提供自动化迁移工具
   - 缓解: 详细的文档和示例
   - 缓解: 社区支持

### 中风险项
1. **性能回退**
   - 缓解: 每个阶段性能测试
   - 缓解: 基准测试对比

2. **构建复杂度增加**
   - 缓解: 优化构建配置
   - 缓解: 使用现代构建工具

### 低风险项
1. **文档维护**
   - 缓解: 自动化文档生成
   - 缓解: 每个 PR 更新文档

## 成功指标

### 代码质量指标
- client.ts 行数: 9510 → ~2000 (-78%)
- 模块数量: 1 → 6+
- 测试覆盖率: 保持 >70%
- 类型安全: 无 any 类型

### 性能指标
- 构建时间: 减少 30%
- 类型检查: 提升 40%
- 包大小: 优化 15%
- 按需加载: 支持

### 开发体验指标
- IDE 响应速度: 提升 50%
- 代码导航: 更快更准确
- 错误定位: 更容易
- 新功能开发: 更快

## 回滚计划

如果重构出现严重问题：

1. **立即回滚**: 恢复到上一个稳定版本
2. **问题分析**: 识别根本原因
3. **修复方案**: 制定修复计划
4. **重新测试**: 完整回归测试
5. **重新发布**: 发布修复版本

## 社区沟通

### 发布前
- 在 GitHub 发布 RFC (Request for Comments)
- 在 Matrix 开发者频道讨论
- 收集社区反馈

### 发布时
- 详细的发布说明
- 迁移指南
- 示例代码

### 发布后
- 监控 GitHub Issues
- 及时响应问题
- 发布补丁版本

## 总结

这是一个长期的、渐进式的重构计划，预计需要 12-18 个月完成。每个阶段都保持向后兼容，给用户充足的迁移时间。最终目标是创建一个模块化、可维护、高性能的 MatrixClient 架构。

## 当前状态

- ✅ 阶段 1 已完成 (v40.x)
- ⏳ 阶段 2 计划中 (v41.0.0, 2026 Q3)
- 📋 后续阶段待规划

## 参考文档

- [迁移指南](./MIGRATION_GUIDE.md)
- [问题状态报告](./PROBLEM_STATUS_REPORT.md)
- [优化总结](./OPTIMIZATION_SUMMARY.md)
