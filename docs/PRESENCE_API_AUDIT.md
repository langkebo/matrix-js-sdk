# Presence 模块 API 审计报告

> 审计日期: 2026-04-04
> 契约文档: `/Users/ljf/Desktop/hu/matrix-js-sdk/docs/api-contract/presence.md`
> 后端实现: `/Users/ljf/Desktop/hu/synapse-rust/src/web/routes/presence.rs`

---

## 1. 审计范围

### 1.1 契约端点统计

| 类别 | 端点数量 | 后端实现 | SDK 封装 |
|------|----------|----------|----------|
| Presence 状态 | 2 | ✅ 完整 | ✅ 已封装 |
| Presence List | 3 | ✅ 完整 | ✅ 已封装 |

---

## 2. 详细比对结果

### 2.1 Presence 状态端点

| 端点 | 契约定义 | 后端实现 | SDK 封装 | 状态 |
|------|----------|----------|----------|------|
| `GET /_matrix/client/{v1,r0,v3}/presence/{user_id}/status` | ✅ | ✅ presence.rs:12-14 | ✅ `PresenceManager.getPresence()` | ✅ OK |
| `PUT /_matrix/client/{v1,r0,v3}/presence/{user_id}/status` | ✅ | ✅ presence.rs:12-14 | ✅ `PresenceManager.setPresence()` | ✅ OK |

### 2.2 Presence List 端点

| 端点 | 契约定义 | 后端实现 | SDK 封装 | 状态 |
|------|----------|----------|----------|------|
| `GET /_matrix/client/v3/presence/list` | ✅ | ✅ presence.rs:19-21 | ✅ `PresenceManager.getSubscribedPresence()` | ✅ OK |
| `POST /_matrix/client/v3/presence/list` | ✅ | ✅ presence.rs:19-21 | ✅ `PresenceManager.subscribeToPresence()` | ✅ OK |
| `GET /_matrix/client/v3/presence/list/{user_id}` | ✅ 已更新 | ✅ presence.rs:20 | ✅ `PresenceManager.getPresenceList()` | ✅ OK |

---

## 3. 发现的问题

### 3.1 ⚠️ 中优先级问题

#### 1. ~~契约文档缺少端点记录~~ ✅ 已修复

**问题描述**: 后端实现了 `GET /_matrix/client/v3/presence/list/{user_id}` 端点，但契约文档未记录。

**修复状态**: ✅ 已更新契约文档

---

#### 2. ~~SDK 缺少 getPresenceList 方法~~ ✅ 已修复

**问题描述**: SDK 没有封装 `GET /_matrix/client/v3/presence/list/{user_id}` 端点。

**修复状态**: ✅ 已添加 `getPresenceList(userId)` 方法

**修复代码** (`presence/index.ts:263-296`):
```typescript
async getPresenceList(userId: string): Promise<IPresenceEvent[]> {
    if (!userId) {
        throw new InvalidParamError("User ID is required");
    }

    try {
        const response = await this.client.http.authedRequest<IPresenceEvent[]>(
            Method.Get,
            `/presence/list/${encodeURIComponent(userId)}`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 }
        );

        const events: IPresenceEvent[] = response || [];

        events.forEach(event => {
            const state: IPresenceState = {
                presence: event.presence,
                status_msg: event.status_msg,
                last_active_ago: event.last_active_ago,
                currently_active: event.currently_active,
            };
            this.presenceCache.set(event.user_id, state);
        });

        return events;
    } catch (error: any) {
        if (error?.httpStatus === 404 || error?.errcode === "M_NOT_FOUND") {
            return [];
        }
        throw this.normalizeError(error, 'getPresenceList');
    }
}
```

---

### 3.2 📝 低优先级问题

#### 3. ~~SDK 错误处理不完善~~ ✅ 已修复

**问题描述**: `getPresence()` 和 `getSubscribedPresence()` 方法吞掉错误返回默认值。

**修复状态**: ✅ 已添加 `normalizeError()` 和 `isRetryableError()` 方法，使用统一的错误分类处理

**修复代码** (`presence/index.ts:77-96`):
```typescript
private normalizeError(error: unknown, method: string): Error {
    const err = error as Error & { httpStatus?: number; errcode?: string };
    if (err?.httpStatus === 401 || err?.errcode === "M_UNKNOWN_TOKEN") {
        return new AuthError(`PresenceManager.${method} failed: ${err.message}`, err);
    }
    if (err?.httpStatus === 404 || err?.errcode === "M_NOT_FOUND") {
        return new NotFoundError(`PresenceManager.${method} failed: ${err.message}`, err);
    }
    if (this.isRetryableError(err)) {
        return new RetryableError(`PresenceManager.${method} failed: ${err.message}`, err);
    }
    return new ApiError(`PresenceManager.${method} failed: ${err.message}`, err?.errcode ?? "UNKNOWN", err?.httpStatus ?? 0, err);
}

private isRetryableError(error: any): boolean {
    return error?.code === "ECONNRESET" ||
           error?.code === "ETIMEDOUT" ||
           error?.code === "ENOTFOUND" ||
           error?.httpStatus >= 500;
}
```

---

## 4. 测试覆盖

### 4.1 单元测试

**测试文件**: `spec/unit/presence.spec.ts`

| 测试类别 | 测试数量 | 状态 |
|----------|----------|------|
| Constructor | 1 | ✅ 通过 |
| setPresence | 8 | ✅ 通过 |
| getPresence | 7 | ✅ 通过 |
| getPresences | 2 | ✅ 通过 |
| subscribeToPresence | 3 | ✅ 通过 |
| unsubscribeFromPresence | 3 | ✅ 通过 |
| getSubscribedPresence | 5 | ✅ 通过 |
| getPresenceList | 8 | ✅ 通过 |
| Convenience methods | 4 | ✅ 通过 |
| clearStatusMessage | 2 | ✅ 通过 |
| updatePresenceFromSync | 2 | ✅ 通过 |
| Cache methods | 2 | ✅ 通过 |
| Subscription methods | 2 | ✅ 通过 |
| start/stop lifecycle | 3 | ✅ 通过 |
| Error handling | 8 | ✅ 通过 |
| **总计** | **60** | ✅ 全部通过 |

---

## 5. 验证结果

### 5.1 后端验证

```
✅ 后端实现完整，所有端点均已实现
✅ 支持 v1/r0/v3 版本兼容
```

### 5.2 SDK 验证

```
✅ 核心功能已封装
✅ getPresenceList 方法已添加
✅ 错误处理已完善
✅ 单元测试全部通过 (60 tests)
```

---

## 6. 结论

### 6.1 当前状态

- ✅ 后端实现完整
- ✅ 契约文档已更新
- ✅ SDK 所有端点已封装
- ✅ SDK 错误处理已完善
- ✅ 单元测试全部通过

### 6.2 封装覆盖率

- **后端路由总数**: 5 个端点
- **SDK 已封装**: 5 个方法
- **完全正确封装**: 5/5 (100%)

### 6.3 修复状态

| 优先级 | 问题 | 影响 | 状态 |
|--------|------|------|------|
| ⚠️ P1 | 契约文档缺少端点 | 文档不完整 | ✅ 已修复 |
| ⚠️ P1 | 缺少 getPresenceList 方法 | 功能不完整 | ✅ 已修复 |
| 📝 P2 | SDK 错误处理不完善 | 问题难以排查 | ✅ 已修复 |
