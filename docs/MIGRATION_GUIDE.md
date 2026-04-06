# Matrix JS SDK 迁移指南

## 从 MatrixClient 直接方法迁移到 Manager API

本指南帮助您从 MatrixClient 的废弃方法迁移到新的 Manager API。Manager API 提供更好的缓存、事件发射和错误处理机制。

---

## 为什么要迁移？

### Manager API 的优势
1. **更好的缓存**: 使用 LRU 缓存，自动管理内存
2. **事件发射**: 状态变更时自动发射事件
3. **统一错误处理**: 规范化的错误类型和重试逻辑
4. **类型安全**: 完整的 TypeScript 类型定义
5. **可测试性**: 独立的 Manager 更容易测试

### 废弃时间表
- **v40.x**: 方法标记为 @deprecated，仍然可用
- **v41.0.0**: 废弃方法将被移除（预计 2026 Q3）
- **迁移期**: 至少 6 个月

---

## Profile 管理迁移

### 设置用户资料信息

**旧方式** (废弃):
```typescript
// ❌ 将在 v41.0.0 移除
await client.setProfileInfo('avatar_url', { 
    avatar_url: 'mxc://example.com/avatar' 
});
```

**新方式** (推荐):
```typescript
// ✅ 使用 ProfileManager
const profileManager = client.getProfileManager();
await profileManager.setProfileInfo('avatar_url', { 
    avatar_url: 'mxc://example.com/avatar' 
});
```

### 设置显示名称

**旧方式** (废弃):
```typescript
// ❌ 将在 v41.0.0 移除
await client.setDisplayName('Alice');
```

**新方式** (推荐):
```typescript
// ✅ 使用 ProfileManager
const profileManager = client.getProfileManager();
await profileManager.setDisplayName('Alice');
```

### 设置头像

**旧方式** (废弃):
```typescript
// ❌ 将在 v41.0.0 移除
await client.setAvatarUrl('mxc://example.com/avatar');
```

**新方式** (推荐):
```typescript
// ✅ 使用 ProfileManager
const profileManager = client.getProfileManager();
await profileManager.setAvatarUrl('mxc://example.com/avatar');
```

### 获取用户资料

**旧方式** (废弃):
```typescript
// ❌ 将在 v41.0.0 移除
const profile = await client.getProfileInfo('@user:example.com');
```

**新方式** (推荐):
```typescript
// ✅ 使用 ProfileManager，带缓存
const profileManager = client.getProfileManager();
const profile = await profileManager.getProfileInfo('@user:example.com');
```

### MXC URL 转换

**旧方式** (废弃):
```typescript
// ❌ 将在 v41.0.0 移除
const httpUrl = client.mxcUrlToHttp('mxc://example.com/file');
```

**新方式** (推荐):
```typescript
// ✅ 使用 ProfileManager
const profileManager = client.getProfileManager();
const httpUrl = profileManager.mxcUrlToHttp('mxc://example.com/file');
```

---

## Presence 管理迁移

### 设置在线状态

**旧方式** (废弃):
```typescript
// ❌ 将在 v41.0.0 移除
await client.setPresence({
    presence: 'online',
    status_msg: 'Working'
});
```

**新方式** (推荐):
```typescript
// ✅ 使用 PresenceManager
const presenceManager = client.getPresenceManager();
await presenceManager.setPresence({
    presence: 'online',
    status_msg: 'Working'
});
```

### 获取用户在线状态

**旧方式** (废弃):
```typescript
// ❌ 将在 v41.0.0 移除
const presence = await client.getPresence('@user:example.com');
```

**新方式** (推荐):
```typescript
// ✅ 使用 PresenceManager，带缓存
const presenceManager = client.getPresenceManager();
const presence = await presenceManager.getPresence('@user:example.com');
```

---

## Device 管理迁移

### 获取设备列表

**旧方式** (废弃):
```typescript
// ❌ 将在 v41.0.0 移除
const devices = await client.getDevices();
```

**新方式** (推荐):
```typescript
// ✅ 使用 DeviceManager
const deviceManager = client.getDeviceManager();
const devices = await deviceManager.getDevices();
```

### 获取单个设备信息

**旧方式** (废弃):
```typescript
// ❌ 将在 v41.0.0 移除
const device = await client.getDevice('DEVICE_ID');
```

**新方式** (推荐):
```typescript
// ✅ 使用 DeviceManager
const deviceManager = client.getDeviceManager();
const device = await deviceManager.getDevice('DEVICE_ID');
```

### 更新设备信息

**旧方式** (废弃):
```typescript
// ❌ 将在 v41.0.0 移除
await client.setDeviceDetails('DEVICE_ID', {
    display_name: 'My Phone'
});
```

**新方式** (推荐):
```typescript
// ✅ 使用 DeviceManager
const deviceManager = client.getDeviceManager();
await deviceManager.updateDevice('DEVICE_ID', {
    display_name: 'My Phone'
});
```

### 删除设备

**旧方式** (废弃):
```typescript
// ❌ 将在 v41.0.0 移除
await client.deleteDevice('DEVICE_ID', { 
    type: 'm.login.password',
    password: 'secret'
});
```

**新方式** (推荐):
```typescript
// ✅ 使用 DeviceManager
const deviceManager = client.getDeviceManager();
await deviceManager.deleteDevice('DEVICE_ID', { 
    type: 'm.login.password',
    password: 'secret'
});
```

### 批量删除设备

**旧方式** (废弃):
```typescript
// ❌ 将在 v41.0.0 移除
await client.deleteMultipleDevices(['DEVICE1', 'DEVICE2'], {
    type: 'm.login.password',
    password: 'secret'
});
```

**新方式** (推荐):
```typescript
// ✅ 使用 DeviceManager
const deviceManager = client.getDeviceManager();
await deviceManager.deleteDevices(['DEVICE1', 'DEVICE2'], {
    type: 'm.login.password',
    password: 'secret'
});
```

---

## Push 管理迁移

### 获取推送器列表

**旧方式** (废弃):
```typescript
// ❌ 将在 v41.0.0 移除
const pushers = await client.getPushers();
```

**新方式** (推荐):
```typescript
// ✅ 使用 PushManager
const pushManager = client.getPushManager();
const pushers = await pushManager.getPushers();
```

### 设置推送器

**旧方式** (废弃):
```typescript
// ❌ 将在 v41.0.0 移除
await client.setPusher({
    kind: 'http',
    app_id: 'com.example.app',
    pushkey: 'push_key',
    data: { url: 'https://push.example.com' }
});
```

**新方式** (推荐):
```typescript
// ✅ 使用 PushManager
const pushManager = client.getPushManager();
await pushManager.setPusher({
    kind: 'http',
    app_id: 'com.example.app',
    pushkey: 'push_key',
    data: { url: 'https://push.example.com' }
});
```

### 移除推送器

**旧方式** (废弃):
```typescript
// ❌ 将在 v41.0.0 移除
await client.removePusher('push_key', 'com.example.app');
```

**新方式** (推荐):
```typescript
// ✅ 使用 PushManager
const pushManager = client.getPushManager();
await pushManager.removePusher('push_key', 'com.example.app');
```

### 获取推送规则

**旧方式** (废弃):
```typescript
// ❌ 将在 v41.0.0 移除
const rules = await client.getPushRules();
```

**新方式** (推荐):
```typescript
// ✅ 使用 PushManager
const pushManager = client.getPushManager();
const rules = await pushManager.getPushRules();
```

### 添加推送规则

**旧方式** (废弃):
```typescript
// ❌ 将在 v41.0.0 移除
await client.addPushRule('global', 'room', '!room:example.com', {
    actions: ['notify']
});
```

**新方式** (推荐):
```typescript
// ✅ 使用 PushManager
const pushManager = client.getPushManager();
await pushManager.addPushRule('global', 'room', '!room:example.com', {
    actions: ['notify']
});
```

### 删除推送规则

**旧方式** (废弃):
```typescript
// ❌ 将在 v41.0.0 移除
await client.deletePushRule('global', 'room', '!room:example.com');
```

**新方式** (推荐):
```typescript
// ✅ 使用 PushManager
const pushManager = client.getPushManager();
await pushManager.deletePushRule('global', 'room', '!room:example.com');
```

### 启用/禁用推送规则

**旧方式** (废弃):
```typescript
// ❌ 将在 v41.0.0 移除
await client.setPushRuleEnabled('global', 'room', '!room:example.com', true);
```

**新方式** (推荐):
```typescript
// ✅ 使用 PushManager
const pushManager = client.getPushManager();
await pushManager.setPushRuleEnabled('global', 'room', '!room:example.com', true);
```

### 设置推送规则动作

**旧方式** (废弃):
```typescript
// ❌ 将在 v41.0.0 移除
await client.setPushRuleActions('global', 'room', '!room:example.com', ['notify']);
```

**新方式** (推荐):
```typescript
// ✅ 使用 PushManager
const pushManager = client.getPushManager();
await pushManager.setPushRuleActions('global', 'room', '!room:example.com', ['notify']);
```

---

## Room Summary 管理迁移

### 获取房间摘要

**旧方式** (废弃):
```typescript
// ❌ 将在 v41.0.0 移除
const summary = await client.getRoomSummary('!room:example.com');
```

**新方式** (推荐):
```typescript
// ✅ 使用 RoomSummaryManager
const summaryManager = client.getRoomSummaryManager();
const summary = await summaryManager.getRoomSummary('!room:example.com');
```

### 获取房间成员摘要

**旧方式** (废弃):
```typescript
// ❌ 将在 v41.0.0 移除
const members = await client.getRoomSummaryMembers('!room:example.com');
```

**新方式** (推荐):
```typescript
// ✅ 使用 RoomSummaryManager
const summaryManager = client.getRoomSummaryManager();
const members = await summaryManager.getRoomSummaryMembers('!room:example.com');
```

### 获取房间统计

**旧方式** (废弃):
```typescript
// ❌ 将在 v41.0.0 移除
const stats = await client.getRoomSummaryStats('!room:example.com');
```

**新方式** (推荐):
```typescript
// ✅ 使用 RoomSummaryManager
const summaryManager = client.getRoomSummaryManager();
const stats = await summaryManager.getRoomSummaryStats('!room:example.com');
```

---

## 批量迁移示例

### 完整的用户资料更新流程

**旧方式** (废弃):
```typescript
// ❌ 将在 v41.0.0 移除
await client.setDisplayName('Alice');
await client.setAvatarUrl('mxc://example.com/avatar');
await client.setPresence({ presence: 'online' });
```

**新方式** (推荐):
```typescript
// ✅ 使用各个 Manager
const profileManager = client.getProfileManager();
const presenceManager = client.getPresenceManager();

await profileManager.setDisplayName('Alice');
await profileManager.setAvatarUrl('mxc://example.com/avatar');
await presenceManager.setPresence({ presence: 'online' });
```

### 设备管理流程

**旧方式** (废弃):
```typescript
// ❌ 将在 v41.0.0 移除
const devices = await client.getDevices();
const oldDevices = devices.devices.filter(d => isOld(d));
await client.deleteMultipleDevices(
    oldDevices.map(d => d.device_id),
    auth
);
```

**新方式** (推荐):
```typescript
// ✅ 使用 DeviceManager
const deviceManager = client.getDeviceManager();

const devices = await deviceManager.getDevices();
const oldDevices = devices.devices.filter(d => isOld(d));
await deviceManager.deleteDevices(
    oldDevices.map(d => d.device_id),
    auth
);
```

---

## 迁移检查清单

使用以下清单确保完整迁移：

### Profile 相关
- [ ] `setProfileInfo()` → `getProfileManager().setProfileInfo()`
- [ ] `setDisplayName()` → `getProfileManager().setDisplayName()`
- [ ] `setAvatarUrl()` → `getProfileManager().setAvatarUrl()`
- [ ] `getProfileInfo()` → `getProfileManager().getProfileInfo()`
- [ ] `mxcUrlToHttp()` → `getProfileManager().mxcUrlToHttp()`

### Presence 相关
- [ ] `setPresence()` → `getPresenceManager().setPresence()`
- [ ] `getPresence()` → `getPresenceManager().getPresence()`

### Device 相关
- [ ] `getDevices()` → `getDeviceManager().getDevices()`
- [ ] `getDevice()` → `getDeviceManager().getDevice()`
- [ ] `setDeviceDetails()` → `getDeviceManager().updateDevice()`
- [ ] `deleteDevice()` → `getDeviceManager().deleteDevice()`
- [ ] `deleteMultipleDevices()` → `getDeviceManager().deleteDevices()`

### Push 相关
- [ ] `getPushers()` → `getPushManager().getPushers()`
- [ ] `setPusher()` → `getPushManager().setPusher()`
- [ ] `removePusher()` → `getPushManager().removePusher()`
- [ ] `getPushRules()` → `getPushManager().getPushRules()` 
- [ ] `addPushRule()` → `getPushManager().addPushRule()`
- [ ] `deletePushRule()` → `getPushManager().deletePushRule()`
- [ ] `setPushRuleEnabled()` → `getPushManager().setPushRuleEnabled()`
- [ ] `setPushRuleActions()` → `getPushManager().setPushRuleActions()`

### Room Summary 相关
- [ ] `getRoomSummary()` → `getRoomSummaryManager().getRoomSummary()`
- [ ] `getRoomSummaryMembers()` → `getRoomSummaryManager().getRoomSummaryMembers()`
- [ ] `getRoomSummaryStats()` → `getRoomSummaryManager().getRoomSummaryStats()`

---

## 常见问题

### Q: 为什么要迁移？旧方法还能用吗？
A: 旧方法在 v40.x 中仍然可用，但在 v41.0.0 将被移除。Manager API 提供更好的性能和功能。

### Q: 迁移会破坏我的代码吗？
A: 不会。在 v41.0.0 之前，两种方式都可以使用。您有至少 6 个月的迁移期。

### Q: Manager API 有什么额外的好处？
A: 
- 自动缓存，减少网络请求
- 事件发射，实时状态更新
- 统一的错误处理和重试逻辑
- 更好的类型安全

### Q: 如何检测代码中使用了废弃方法？
A: 
1. TypeScript 编译器会显示 @deprecated 警告
2. 使用 ESLint 规则检测废弃 API
3. 查看编辑器中的警告提示

### Q: 迁移需要多长时间？
A: 大多数项目可以在 1-2 天内完成迁移。使用查找替换可以加速过程。

---

## 自动化迁移工具

### 使用 jscodeshift 批量迁移

```bash
# 安装 jscodeshift
npm install -g jscodeshift

# 运行迁移脚本（即将提供）
jscodeshift -t matrix-sdk-migration.js src/
```

### 手动查找替换

在您的 IDE 中使用正则表达式查找替换：

```regex
# 查找: client\.setDisplayName\(
# 替换: client.getProfileManager().setDisplayName(

# 查找: client\.getDevices\(\)
# 替换: client.getDeviceManager().getDevices()
```

---

## 获取帮助

如果您在迁移过程中遇到问题：

1. 查看 [API 文档](https://matrix-org.github.io/matrix-js-sdk/)
2. 提交 [GitHub Issue](https://github.com/matrix-org/matrix-js-sdk/issues)
3. 加入 [Matrix 开发者社区](https://matrix.to/#/#matrix-dev:matrix.org)

---

## 更新日志

- **2026-04-06**: 初始版本，标记 31 个废弃方法
- **2026 Q3**: 计划在 v41.0.0 移除废弃方法
