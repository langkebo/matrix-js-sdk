# Admin API 使用指南

本指南介绍如何使用 matrix-js-sdk 的 Admin API 进行服务器管理操作。

---

## 目录

- [前置要求](#前置要求)
- [快速开始](#快速开始)
- [用户管理](#用户管理)
- [房间管理](#房间管理)
- [服务器管理](#服务器管理)
- [联邦管理](#联邦管理)
- [通知管理](#通知管理)
- [错误处理](#错误处理)
- [最佳实践](#最佳实践)

---

## 前置要求

### 权限要求

Admin API 需要**管理员权限**才能使用。确保：

1. 使用管理员账户的 access token
2. 服务器支持 Synapse Admin API
3. 服务器配置允许管理员操作

### 初始化

```typescript
import { createClient } from "matrix-js-sdk";

const client = createClient({
    baseUrl: "https://matrix.example.com",
    accessToken: "your_admin_access_token",
    userId: "@admin:example.com",
});

// 获取 Admin Manager
const adminManager = client.getAdminManager();
```

---

## 快速开始

### 基本操作示例

```typescript
// 1. 获取用户信息
const user = await adminManager.getUser("@alice:example.com");
console.log(`用户: ${user.displayname}, 管理员: ${user.admin}`);

// 2. 创建新用户
await adminManager.createUser("@bob:example.com", {
    password: "secure123",
    displayname: "Bob Smith",
});

// 3. 获取房间列表
const rooms = await adminManager.getRooms();
console.log(`总共 ${rooms.rooms.length} 个房间`);

// 4. 检查服务器状态
const status = await adminManager.getServerStatus();
console.log(`服务器状态: ${status?.status}`);
```

---

## 用户管理

### 获取用户列表

```typescript
// 获取前 50 个用户
const result = await adminManager.getUsers(undefined, 50);
console.log(`获取 ${result.users.length} 个用户`);

// 分页获取所有用户
let from: string | undefined;
const allUsers: UserInfo[] = [];

do {
    const result = await adminManager.getUsers(from, 100);
    allUsers.push(...result.users);
    from = result.next_token;
} while (from);

console.log(`总共 ${allUsers.length} 个用户`);
```

### 获取用户详情

```typescript
// 获取用户信息
const user = await adminManager.getUser("@alice:example.com");
console.log(`显示名称: ${user.displayname}`);
console.log(`是否管理员: ${user.admin}`);
console.log(`是否停用: ${user.deactivated}`);

// 优雅处理不存在的用户
const user = await adminManager.getUser("@unknown:example.com", false);
if (!user) {
    console.log("用户不存在");
}
```

### 创建用户

```typescript
// 创建普通用户
const user = await adminManager.createUser("@bob:example.com", {
    password: "secure123",
    displayname: "Bob Smith",
});

// 创建管理员用户
const admin = await adminManager.createUser("@admin2:example.com", {
    password: "admin123",
    displayname: "Admin User",
    admin: true,
});

// 创建已停用的用户（用于占位）
const placeholder = await adminManager.createUser("@reserved:example.com", {
    deactivated: true,
});
```

### 用户操作

```typescript
// 重置密码
await adminManager.resetPassword("@alice:example.com", "newpassword123");

// 设置管理员权限
await adminManager.setAdmin("@bob:example.com", true);

// 停用用户
await adminManager.deactivateUser("@spam:example.com");

// 停用并删除用户数据
await adminManager.deactivateUser("@spam:example.com", true);
```

### 设备管理

```typescript
// 获取用户的所有设备
const devices = await adminManager.getUserDevices("@alice:example.com");
devices.forEach((device) => {
    console.log(`设备: ${device.device_id}`);
    console.log(`  名称: ${device.display_name}`);
    console.log(`  最后活跃: ${new Date(device.last_seen_ts!)}`);
});

// 删除单个设备
await adminManager.deleteUserDevice("@alice:example.com", "DEVICE123");

// 批量删除设备
await adminManager.deleteUserDevices("@alice:example.com", ["DEVICE1", "DEVICE2", "DEVICE3"]);
```

### 速率限制

```typescript
// 获取用户的速率限制
const rateLimit = await adminManager.getRateLimit("@alice:example.com");
console.log(`每秒消息数: ${rateLimit?.messages_per_second}`);
console.log(`突发数量: ${rateLimit?.burst_count}`);

// 设置速率限制
await adminManager.setRateLimit("@alice:example.com", {
    messages_per_second: 10,
    burst_count: 20,
});

// 删除速率限制（使用默认值）
await adminManager.deleteRateLimit("@alice:example.com");

// 完全禁用速率限制
await adminManager.overrideRateLimit("@alice:example.com");
```

### Shadow Ban（影子封禁）

```typescript
// 对用户实施影子封禁（用户不知道被封禁）
await adminManager.shadowBanUser("@spammer:example.com");

// 检查封禁状态
const status = await adminManager.getShadowBanStatus("@spammer:example.com");
if (status?.banned) {
    console.log(`用户已被封禁，时间: ${new Date(status.banned_at!)}`);
}

// 取消影子封禁
await adminManager.unshadowBanUser("@spammer:example.com");
```

---

## 房间管理

### 获取房间列表

```typescript
// 获取所有房间
const result = await adminManager.getRooms();
console.log(`总共 ${result.rooms.length} 个房间`);

// 搜索房间
const result = await adminManager.getRooms(undefined, 50, "general");
result.rooms.forEach((room) => {
    console.log(`${room.name} (${room.room_id})`);
    console.log(`  成员数: ${room.joined_members}`);
});

// 分页获取
let from: string | undefined;
do {
    const result = await adminManager.getRooms(from, 100);
    // 处理房间...
    from = result.next_token;
} while (from);
```

### 房间详情

```typescript
// 获取房间信息
const room = await adminManager.getRoom("!abc123:example.com");
console.log(`房间名称: ${room.name}`);
console.log(`创建者: ${room.creator}`);
console.log(`成员数: ${room.joined_members}`);
console.log(`是否公开: ${room.public}`);

// 获取房间成员
const members = await adminManager.getRoomMembers("!abc123:example.com");
console.log(`成员: ${members.join(", ")}`);

// 获取房间状态
const state = await adminManager.getRoomState("!abc123:example.com");
state.state.forEach((event) => {
    console.log(`${event.type}: ${event.state_key}`);
});
```

### 房间操作

```typescript
// 删除房间
await adminManager.deleteRoom("!spam:example.com");

// 删除房间并清除历史
await adminManager.deleteRoom("!spam:example.com", {
    purge: true,
});

// 封禁房间（阻止新用户加入）
await adminManager.blockRoom("!spam:example.com", true);

// 解封房间
await adminManager.blockRoom("!spam:example.com", false);

// 关闭房间（踢出所有成员）
const result = await adminManager.shutdownRoom("!spam:example.com");
console.log(`踢出 ${result.kicked_users.length} 个用户`);
console.log(`失败 ${result.failed_to_kick_users.length} 个`);
```

### 房间成员管理

```typescript
// 强制用户加入房间
await adminManager.forceJoinRoom("!room:example.com", "@alice:example.com");

// 强制用户离开房间
await adminManager.forceLeaveRoom("!room:example.com", "@alice:example.com");

// 封禁用户
await adminManager.banUser("!room:example.com", "@spammer:example.com", "垃圾消息");

// 解封用户
await adminManager.unbanUser("!room:example.com", "@spammer:example.com");

// 踢出用户
await adminManager.kickUser("!room:example.com", "@alice:example.com", "违反规则");
```

---

## 服务器管理

### 服务器状态

```typescript
// 获取服务器状态
const status = await adminManager.getServerStatus();
if (status?.status === "online") {
    console.log(`服务器在线，运行时间: ${status.uptime}秒`);
}

// 获取服务器健康状态
const health = await adminManager.getServerHealth();
if (health?.healthy) {
    console.log("服务器健康");
} else {
    console.log("服务器异常:", health?.checks);
}

// 获取服务器信息
const info = await adminManager.getServerInfo();
console.log(`服务器: ${info?.server_name}`);
console.log(`版本: ${info?.version}`);
console.log(`联邦: ${info?.federation_enabled ? "启用" : "禁用"}`);
```

### 服务器统计

```typescript
// 获取服务器统计
const stats = await adminManager.getServerStats();
console.log(`总用户数: ${stats.total_users}`);
console.log(`总房间数: ${stats.total_rooms}`);
console.log(`日活跃用户: ${stats.daily_active_users}`);
console.log(`月活跃用户: ${stats.monthly_active_users}`);

// 获取缓存的统计（避免重复请求）
const cachedStats = adminManager.getCachedServerStats();
```

### 服务器配置

```typescript
// 获取服务器配置
const config = await adminManager.getServerConfig();
console.log("服务器配置:", config);

// 获取服务器版本
const version = await adminManager.getServerVersion();
console.log(`服务器版本: ${version.server_version}`);
console.log(`Python 版本: ${version.python_version}`);
```

---

## 联邦管理

### 联邦黑名单

```typescript
// 获取黑名单
const blacklist = await adminManager.getFederationBlacklist();
console.log(`黑名单中有 ${blacklist.length} 个服务器`);
blacklist.forEach((entry) => {
    console.log(`${entry.server_name}: ${entry.reason}`);
});

// 添加到黑名单
await adminManager.addToFederationBlacklist("spam-server.com", "发送垃圾消息");

// 从黑名单移除
await adminManager.removeFromFederationBlacklist("spam-server.com");

// 批量添加
const spamServers = ["spam1.com", "spam2.com", "spam3.com"];
for (const server of spamServers) {
    await adminManager.addToFederationBlacklist(server, "垃圾服务器");
}
```

### 联邦连接

```typescript
// 获取联邦目的地列表
const destinations = await adminManager.getFederationDestinations();
destinations.forEach((dest) => {
    console.log(`${dest.destination}: 最后重试 ${dest.retry_last_ts}`);
});

// 获取特定目的地详情
const dest = await adminManager.getFederationDestination("matrix.org");
console.log(`重试间隔: ${dest?.retry_interval}ms`);

// 重置联邦连接
await adminManager.resetFederationConnection("matrix.org");

// 断开联邦连接
await adminManager.disconnectFederation("spam-server.com");
```

---

## 通知管理

### 发送服务器通知

```typescript
// 发送文本通知
const result = await adminManager.sendServerNotice("@user:example.com", {
    msgtype: "m.text",
    body: "重要通知：服务器将于今晚 22:00 维护",
});
console.log(`通知已发送，事件 ID: ${result.event_id}`);

// 发送 HTML 格式通知
await adminManager.sendServerNotice("@user:example.com", {
    msgtype: "m.text",
    body: "系统更新",
    format: "org.matrix.custom.html",
    formatted_body: "<strong>系统更新</strong><br>新功能已上线",
});

// 批量发送通知
const users = ["@alice:example.com", "@bob:example.com"];
for (const userId of users) {
    await adminManager.sendServerNotice(userId, {
        msgtype: "m.text",
        body: "系统维护通知",
    });
}
```

### 获取通知列表

```typescript
// 获取最近的通知
const result = await adminManager.getServerNotices(50);
result?.notices.forEach((notice) => {
    console.log(`发送给: ${notice.user_id}`);
    console.log(`时间: ${new Date(notice.sent_ts)}`);
    console.log(`内容: ${notice.content}`);
});
```

---

## 错误处理

### 错误类型

Admin API 可能抛出以下错误：

- `ValidationError` - 输入验证失败
- `AuthError` - 认证失败（401）
- `NotFoundError` - 资源不存在（404）
- `ApiError` - API 调用失败
- `RetryableError` - 可重试的错误（网络问题）

### 错误处理示例

```typescript
import { ValidationError, AuthError, NotFoundError, ApiError } from "matrix-js-sdk";

try {
    await adminManager.getUser("@alice:example.com");
} catch (error) {
    if (error instanceof ValidationError) {
        console.error("输入格式错误:", error.message);
    } else if (error instanceof AuthError) {
        console.error("认证失败，请检查 access token");
    } else if (error instanceof NotFoundError) {
        console.error("用户不存在");
    } else if (error instanceof ApiError) {
        console.error(`API 错误 [${error.statusCode}]:`, error.message);
    } else {
        console.error("未知错误:", error);
    }
}
```

### 优雅降级

```typescript
// 使用 throwOnError=false 优雅处理错误
const user = await adminManager.getUser("@unknown:example.com", false);
if (!user) {
    console.log("用户不存在，使用默认值");
    // 使用默认值或跳过
}

// 批量操作时继续处理
const userIds = ["@alice:example.com", "@bob:example.com", "@invalid"];
for (const userId of userIds) {
    const user = await adminManager.getUser(userId, false);
    if (user) {
        console.log(`处理用户: ${user.displayname}`);
    } else {
        console.log(`跳过无效用户: ${userId}`);
    }
}
```

---

## 最佳实践

### 1. 输入验证

始终验证用户输入，避免无效的 API 调用：

```typescript
import { AdminValidators } from "matrix-js-sdk/admin/validators";

// 在调用 API 前验证
try {
    AdminValidators.validateUserId(userId);
    const user = await adminManager.getUser(userId);
} catch (error) {
    if (error instanceof ValidationError) {
        console.error("用户 ID 格式错误");
    }
}
```

### 2. 分页处理

处理大量数据时使用分页：

```typescript
async function getAllUsers(): Promise<UserInfo[]> {
    const allUsers: UserInfo[] = [];
    let from: string | undefined;

    do {
        const result = await adminManager.getUsers(from, 100);
        allUsers.push(...result.users);
        from = result.next_token;

        // 避免过快请求
        await new Promise((resolve) => setTimeout(resolve, 100));
    } while (from);

    return allUsers;
}
```

### 3. 错误重试

对于可重试的错误，实现重试逻辑：

```typescript
async function retryOperation<T>(operation: () => Promise<T>, maxRetries: number = 3): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await operation();
        } catch (error) {
            if (error instanceof RetryableError && i < maxRetries - 1) {
                await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
                continue;
            }
            throw error;
        }
    }
    throw new Error("Max retries exceeded");
}

// 使用
const user = await retryOperation(() => adminManager.getUser("@alice:example.com"));
```

### 4. 批量操作

批量操作时控制并发数：

```typescript
async function batchOperation<T>(
    items: T[],
    operation: (item: T) => Promise<void>,
    concurrency: number = 5,
): Promise<void> {
    for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency);
        await Promise.all(batch.map(operation));
    }
}

// 使用
await batchOperation(
    userIds,
    async (userId) => {
        await adminManager.deactivateUser(userId);
    },
    5, // 每次处理 5 个
);
```

### 5. 监听事件

监听 Admin 事件以响应操作：

```typescript
adminManager.on(AdminEvent.UserCreated, (userId, user) => {
    console.log(`新用户创建: ${userId}`);
});

adminManager.on(AdminEvent.UserDeactivated, (userId) => {
    console.log(`用户已停用: ${userId}`);
});

adminManager.on(AdminEvent.RoomDeleted, (roomId) => {
    console.log(`房间已删除: ${roomId}`);
});

adminManager.on(AdminEvent.AdminError, (error) => {
    console.error("Admin 操作错误:", error);
});
```

---

## 常见问题

### Q: 如何判断用户是否有管理员权限？

```typescript
const user = await adminManager.getUser("@alice:example.com");
if (user.admin) {
    console.log("用户是管理员");
}

// 或使用专用方法
const isAdmin = await adminManager.isAdmin("@alice:example.com");
```

### Q: 如何安全地删除房间？

```typescript
// 1. 先获取房间信息
const room = await adminManager.getRoom("!room:example.com");
console.log(`准备删除房间: ${room.name}`);

// 2. 获取成员列表
const members = await adminManager.getRoomMembers("!room:example.com");
console.log(`房间有 ${members.length} 个成员`);

// 3. 确认后删除
await adminManager.deleteRoom("!room:example.com", {
    purge: true, // 清除历史记录
});
```

### Q: 如何处理大量用户的批量操作？

使用分页和并发控制：

```typescript
async function deactivateInactiveUsers(inactiveDays: number) {
    let from: string | undefined;
    const cutoffTime = Date.now() - inactiveDays * 24 * 60 * 60 * 1000;

    do {
        const result = await adminManager.getUsers(from, 100);

        for (const user of result.users) {
            if (user.last_seen_ts && user.last_seen_ts < cutoffTime) {
                await adminManager.deactivateUser(user.user_id);
                console.log(`停用不活跃用户: ${user.user_id}`);
            }
        }

        from = result.next_token;
        await new Promise((resolve) => setTimeout(resolve, 100));
    } while (from);
}
```

---

## 参考资料

- [Admin API 覆盖率报告](./api-contract/ADMIN_SDK_COVERAGE_REPORT.md)
- [Admin API 契约文档](./api-contract/admin.md)
- [SDK 优化总结](./SDK_OPTIMIZATION_SUMMARY_2026-04-15.md)
- [Matrix Synapse Admin API 文档](https://matrix-org.github.io/synapse/latest/usage/administration/admin_api/)

---

**最后更新**: 2026-04-15  
**SDK 版本**: v40.2.0
