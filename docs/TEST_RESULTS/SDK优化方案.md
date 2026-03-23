# Matrix SDK 项目系统性优化方案

> **创建日期**: 2026-03-19
> **文档版本**: 1.0
> **基于**: SDK真实服务器测试失败记录

---

## 一、现状分析

### 1.1 测试结果总结

根据 step-failures.md 记录：

| 类别 | 数量 | 状态 |
|------|------|------|
| 总测试用例 | 249 | ✅ 100% 通过 |
| API 404 错误 | 5 | 已修复 1 个 |
| SDK 功能跳过 | 29 | 需要分析优化 |

### 1.2 SDK 功能跳过分类

#### A. 需要完整客户端初始化的功能 (需修复)

| # | 功能 | 当前状态 | 影响 |
|---|------|----------|------|
| 1 | startClient | ⚠️ Skipped | 高 |
| 2 | stopClient | ⚠️ Skipped | 高 |
| 3 | getPendingEvents | ⚠️ Skipped | 中 |
| 4 | hasPendingEvent | ⚠️ Skipped | 中 |

#### B. SDK 方法不存在的功能 (需添加)

| # | 功能 | 当前状态 | 影响 |
|---|------|----------|------|
| 1 | isStarted | ❌ 不存在 | 低 |
| 2 | awaitSync | ❌ 不存在 | 中 |
| 3 | isSynchronous | ❌ 不存在 | 低 |
| 4 | getEventRenderer | ❌ 不存在 | 低 |
| 5 | getRoomRenderer | ❌ 不存在 | 低 |
| 6 | getMessageTemplates | ❌ 不存在 | 低 |

#### C. 需要后端支持的 SDK 功能 (需验证)

| # | 功能 | 后端状态 | 说明 |
|---|------|----------|------|
| 1 | getThreadsNotifications | ❌ 404 | 后端未实现 |
| 2 | getProtocol | ⚠️ 未使用 | 可选 |
| 3 | getPublicRoomKeys | ⚠️ 未使用 | 可选 |

---

## 二、SDK 优化方案

### 2.1 高优先级优化

#### 2.1.1 添加 `isStarted` 方法

**问题**: SDK 中不存在 `isStarted` 方法

**当前状态**:
```typescript
// 测试代码尝试调用
await runTest("isStarted", async () => {
    // SDK中不存在此方法，跳过
    console.log("⚠️ Skipped - method not in SDK");
});
```

**实现方案**:
```typescript
// 在 client.ts 中添加

/**
 * 检查客户端是否已启动
 * @returns true 如果 startClient 已调用且未调用 stopClient
 */
public isStarted(): boolean {
    return this.clientState !== ClientState.Stopped;
}
```

**修改文件**: `/src/client.ts`

**测试验证**:
```bash
npx tsx spec/integ/real-backend/step11-lifecycle.test.ts
```

---

#### 2.1.2 添加 `awaitSync` 方法

**问题**: SDK 中不存在 `awaitSync` 方法

**实现方案**:
```typescript
// 在 client.ts 中添加

/**
 * 等待首次同步完成
 * @param timeoutMs 超时时间，默认 30000ms
 * @returns Promise 在同步完成时 resolve，超时时 reject
 */
public async awaitSync(timeoutMs: number = 30000): Promise<void> {
    if (this.isInitialSyncComplete()) {
        return;
    }

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            this.off("sync", onSync);
            reject(new Error("Sync timeout"));
        }, timeoutMs);

        const onSync = (state: SyncState) => {
            if (state === "PREPARED" || state === "SYNCING") {
                clearTimeout(timeout);
                this.off("sync", onSync);
                resolve();
            }
        };

        this.on("sync", onSync);
    });
}
```

---

#### 2.1.3 添加 `isSynchronous` 方法

**问题**: SDK 中不存在 `isSynchronous` 方法

**实现方案**:
```typescript
// 在 client.ts 中添加

/**
 * 检查客户端是否配置为同步模式
 * @returns true 如果使用同步模式
 */
public isSynchronous(): boolean {
    return this.syncApi?.isSynchronous() ?? false;
}
```

---

### 2.2 中优先级优化

#### 2.2.1 完善 `startClient` 测试支持

**问题**: startClient 需要完整客户端初始化，测试中被跳过

**分析**: startClient 是 SDK 的核心方法，用于启动客户端并开始同步。但在简单 HTTP 测试环境中，startClient 会尝试建立 WebSocket 连接，导致测试环境复杂。

**建议方案**:
1. 添加 `startClientWithoutWebSocket` 选项用于测试
2. 或在测试中使用 mock 替代

**实现**:
```typescript
// 在 client.ts 中修改 startClient

public async startClient(opts?: IStartClientOpts): Promise<void> {
    // ... 现有代码 ...

    // 添加测试支持
    if (opts?.disableWebSocket) {
        this.emit("sync", SyncState.Prepared);
        return;
    }

    // ... 现有代码 ...
}
```

---

#### 2.2.2 添加 Ephemeral 事件支持

**问题**: `getEphemeralEvents`, `sendTyping`, `setTyping`, `sendReadReceipt`, `setRoomReadMarkers` 被跳过

**分析**: 这些方法在 SDK 中已存在，但测试中使用简单 HTTP 客户端调用，没有通过完整的事件系统。

**测试改进**:
```typescript
// 修改测试以使用 SDK 的正确方法

await runTest("sendTyping", async () => {
    // 使用 SDK 的 sendTyping 方法
    await client!.sendTypingEvent(testRoomId!, {
        typing: true,
        timeout: 5000
    });
});
```

---

### 2.3 低优先级优化

#### 2.3.1 添加 Rendering 相关方法

**问题**: `getEventRenderer`, `getRoomRenderer`, `getMessageTemplates` 不存在

**实现方案**:
```typescript
// 在 client.ts 中添加

/**
 * 获取事件渲染器
 */
public getEventRenderer(): EventRenderer {
    return new EventRenderer();
}

/**
 * 获取房间渲染器
 */
public getRoomRenderer(): RoomRenderer {
    return new RoomRenderer();
}

/**
 * 获取消息模板
 */
public getMessageTemplates(): Record<string, any> {
    return {
        "m.room.message": "templates/message.html",
        "m.room.encrypted": "templates/encrypted.html"
    };
}
```

---

## 三、测试改进方案

### 3.1 测试跳过机制改进

当前测试使用 `runTest` 函数，即使跳过也计为通过。建议改为：

```typescript
async function runTest(name: string, fn: (() => Promise<void>) | null): Promise<void> {
    if (fn === null) {
        console.log(`  Testing: ${name}...`);
        console.log(`    ⚠️ SKIPPED - Not implemented`);
        testResults.push({ name, passed: false, error: "Not implemented" });
        return;
    }
    // ... existing code
}
```

### 3.2 测试分类

| 测试类型 | 说明 | 运行方式 |
|----------|------|----------|
| Unit Tests | 单元测试 | `pnpm test:unit` |
| Integration Tests | 集成测试 | `pnpm test:integ` |
| Real Backend Tests | 真实后端测试 | `npx tsx spec/integ/real-backend/*.ts` |

---

## 四、实现步骤

### 4.1 第一阶段：添加缺失方法 (预计 2h)

| # | 任务 | 文件 | 状态 |
|---|------|------|------|
| 1 | 添加 `isStarted()` | client.ts | ⏳ |
| 2 | 添加 `awaitSync()` | client.ts | ⏳ |
| 3 | 添加 `isSynchronous()` | client.ts | ⏳ |

### 4.2 第二阶段：完善测试 (预计 1h)

| # | 任务 | 文件 | 状态 |
|---|------|------|------|
| 1 | 修复 Ephemeral 测试 | step11-lifecycle.test.ts | ⏳ |
| 2 | 添加测试跳过标记 | 所有测试文件 | ⏳ |

### 4.3 第三阶段：验证测试 (预计 1h)

| # | 任务 | 说明 | 状态 |
|---|------|------|------|
| 1 | 运行所有测试 | `npx tsx spec/integ/real-backend/*.ts` | ⏳ |
| 2 | 验证通过率 | 目标: 100% | ⏳ |

---

## 五、兼容性处理

### 5.1 向后兼容

所有新增方法需要保持向后兼容：

```typescript
// 使用可选链避免破坏旧代码
public isStarted(): boolean {
    return this.clientState !== undefined && this.clientState !== ClientState.Stopped;
}
```

### 5.2 API 版本兼容

检查 Matrix API 版本支持：

```typescript
public async ensureSupportsFeature(feature: string): Promise<boolean> {
    const versions = await this.getClientVersions();
    return versions.includes(feature);
}
```

---

## 六、测试计划

### 6.1 测试用例

| # | 测试名称 | 输入 | 预期结果 | 状态 |
|---|----------|------|----------|------|
| 1 | testIsStarted | 调用 isStarted() | 返回 false (未启动) | ⏳ |
| 2 | testIsStartedAfterStart | 调用 startClient 后 | 返回 true | ⏳ |
| 3 | testAwaitSync | 调用 awaitSync() | 同步完成时 resolve | ⏳ |
| 4 | testAwaitSyncTimeout | awaitSync(100) | 100ms 后 reject | ⏳ |

### 6.2 运行命令

```bash
# 运行所有 SDK 测试
cd /Users/ljf/Desktop/hu/matrix-js-sdk

# 运行 Lifecycle 测试
npx tsx spec/integ/real-backend/step11-lifecycle.test.ts

# 运行所有真实后端测试
for i in step*.test.ts; do
    echo "=== Testing $i ==="
    npx tsx "spec/integ/real-backend/$i" 2>&1 | tail -10
done
```

---

## 七、后续行动

| # | 行动 | 负责人 | 截止日期 | 状态 |
|---|------|--------|----------|------|
| 1 | 实现 isStarted 方法 | 待分配 | 2026-03-19 | ⏳ |
| 2 | 实现 awaitSync 方法 | 待分配 | 2026-03-19 | ⏳ |
| 3 | 完善 Ephemeral 测试 | 待分配 | 2026-03-19 | ⏳ |
| 4 | 运行所有测试验证 | 待分配 | 2026-03-19 | ⏳ |

---

*文档版本: 1.0*
*创建时间: 2026-03-19*
*最后更新: 2026-03-19*
