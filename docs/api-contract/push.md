# Push 模块 API 契约

> 推送相关 API 的 SDK 与后端接口契约

## 概述

Push 模块涉及以下 Matrix API：

| 功能 | Matrix API | 说明 |
|------|------------|------|
| 获取推送规则 | `/_matrix/client/v3/push_rules` | GET |
| 设置推送规则 | `/_matrix/client/v3/push_rules/{scope}/{kind}/{ruleId}` | PUT/DELETE |
| 获取推送器 | `/_matrix/client/v3/pushers` | GET |
| 设置推送器 | `/_matrix/client/v3/pushers` | POST |
| 启用/禁用推送规则 | `/_matrix/client/v3/pushrules/{scope}/{kind}/{ruleId}/enabled` | PUT |
| 更新推送规则动作 | `/_matrix/client/v3/pushrules/{scope}/{kind}/{ruleId}/actions` | PUT |

---

## 获取推送规则 / Get Push Rules

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/push_rules` |
| HTTP 方法 | GET |
| SDK 方法 | `client.getPushRules()` |
| SDK 模块 | `matrix-js-sdk/src/push/index.ts` (PushManager) |
| 认证要求 | 是 |

### 请求参数

无。

### 响应结构

```typescript
interface PushRulesResponse {
    global: {
        override?: PushRule[];
        content?: PushRule[];
        room?: PushRule[];
        sender?: PushRule[];
        underride?: PushRule[];
    };
}

interface PushRule {
    rule_id: string;
    default: boolean;
    enabled: boolean;
    pattern?: string;
    conditions?: Array<{
        kind: string;
        key?: string;
        pattern?: string;
        [key: string]: unknown;
    }>;
    actions: Array<string | {
        set_tweak: string;
        value?: unknown;
    }>;
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 获取成功 |
| 401 | 未认证或 Token 无效 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/push.rs` - `get_push_rules()`
- **SDK 封装**: [matrix-js-sdk/src/push/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/push/index.ts) - `PushManager.getPushRules()`
- **前端调用**: [hula/src/services/matrix/MatrixPushService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixPushService.ts) - `getPushRules()`

---

## 设置推送规则 / Set Push Rule

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/push_rules/{scope}/{kind}/{ruleId}` |
| HTTP 方法 | PUT |
| SDK 方法 | `client.addPushRule()` |
| SDK 模块 | `matrix-js-sdk/src/push/index.ts` (PushManager) |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `scope` | `string` | 是 | 规则范围（如 `global`） |
| `kind` | `PushRuleKind` | 是 | 规则类型：`content`, `override`, `room`, `sender`, `underride` |
| `ruleId` | `string` | 是 | 规则 ID |
| `pattern` | `string` | 否 | 匹配模式（content/room 类型使用） |
| `conditions` | `array` | 否 | 条件数组 |
| `actions` | `array` | 否 | 动作数组 |

### 请求示例

```typescript
await client.addPushRule('global', 'content', 'rule_name', {
    pattern: 'keyword',
    actions: ['notify', { set_tweak: 'highlight' }]
});
```

### 响应结构

```typescript
interface EmptyObject {}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 设置成功 |
| 400 | 参数错误 |
| 401 | 未认证或 Token 无效 |
| 404 | 规则不存在 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/push.rs` - `set_push_rule()`
- **SDK 封装**: [matrix-js-sdk/src/push/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/push/index.ts) - `PushManager.addPushRule()`
- **前端调用**: [hula/src/services/matrix/MatrixPushService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixPushService.ts) - `addPushRule()`

---

## 删除推送规则 / Delete Push Rule

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/push_rules/{scope}/{kind}/{ruleId}` |
| HTTP 方法 | DELETE |
| SDK 方法 | `client.deletePushRule()` |
| SDK 模块 | `matrix-js-sdk/src/push/index.ts` (PushManager) |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `scope` | `string` | 是 | 规则范围（如 `global`） |
| `kind` | `PushRuleKind` | 是 | 规则类型 |
| `ruleId` | `string` | 是 | 规则 ID |

### 响应结构

```typescript
interface EmptyObject {}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 删除成功 |
| 401 | 未认证或 Token 无效 |
| 404 | 规则不存在 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/push.rs` - `delete_push_rule()`
- **SDK 封装**: [matrix-js-sdk/src/push/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/push/index.ts) - `PushManager.deletePushRule()`
- **前端调用**: [hula/src/services/matrix/MatrixPushService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixPushService.ts) - `deletePushRule()`

---

## 启用/禁用推送规则 / Enable/Disable Push Rule

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/pushrules/{scope}/{kind}/{ruleId}/enabled` |
| HTTP 方法 | PUT |
| SDK 方法 | `client.setPushRuleEnabled()` |
| SDK 模块 | `matrix-js-sdk/src/push/index.ts` (PushManager) |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `scope` | `string` | 是 | 规则范围（如 `global`） |
| `kind` | `PushRuleKind` | 是 | 规则类型 |
| `ruleId` | `string` | 是 | 规则 ID |
| `enabled` | `boolean` | 是 | 是否启用 |

### 请求示例

```typescript
await client.setPushRuleEnabled('global', 'override', '.m.rule.master', false);
```

### 响应结构

```typescript
interface EmptyObject {}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 操作成功 |
| 401 | 未认证或 Token 无效 |
| 404 | 规则不存在 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/push.rs` - `set_push_rule_enabled()`
- **SDK 封装**: [matrix-js-sdk/src/push/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/push/index.ts) - `PushManager.setPushRuleEnabled()`
- **前端调用**: [hula/src/services/matrix/MatrixPushService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixPushService.ts)

---

## 更新推送规则动作 / Set Push Rule Actions

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/pushrules/{scope}/{kind}/{ruleId}/actions` |
| HTTP 方法 | PUT |
| SDK 方法 | `client.setPushRuleActions()` |
| SDK 模块 | `matrix-js-sdk/src/push/index.ts` (PushManager) |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `scope` | `string` | 是 | 规则范围（如 `global`） |
| `kind` | `PushRuleKind` | 是 | 规则类型 |
| `ruleId` | `string` | 是 | 规则 ID |
| `actions` | `array` | 是 | 新的动作列表 |

### 请求示例

```typescript
await client.setPushRuleActions('global', 'content', 'rule_name', [
    'notify',
    { set_tweak: 'highlight' },
    { set_tweak: 'sound', value: 'default' }
]);
```

### 响应结构

```typescript
interface EmptyObject {}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 更新成功 |
| 401 | 未认证或 Token 无效 |
| 404 | 规则不存在 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/push.rs` - `set_push_rule_actions()`
- **SDK 封装**: [matrix-js-sdk/src/push/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/push/index.ts) - `PushManager.setPushRuleActions()`
- **前端调用**: [hula/src/services/matrix/MatrixPushService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixPushService.ts)

---

## 获取推送器 / Get Pushers

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/pushers` |
| HTTP 方法 | GET |
| SDK 方法 | `client.getPushers()` |
| SDK 模块 | `matrix-js-sdk/src/push/index.ts` (PushManager) |
| 认证要求 | 是 |

### 请求参数

无。

### 响应结构

```typescript
interface PushersResponse {
    pushers: Pusher[];
}

interface Pusher {
    pushkey: string;
    kind: 'http' | string;
    app_id: string;
    app_display_name: string;
    device_display_name: string;
    profile_tag?: string;
    lang?: string;
    data: {
        url?: string;
        format?: string;
        [key: string]: unknown;
    };
    device_id?: string;
    enabled?: boolean;
}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 获取成功 |
| 401 | 未认证或 Token 无效 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/push.rs` - `get_pushers()`
- **SDK 封装**: [matrix-js-sdk/src/push/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/push/index.ts) - `PushManager.getPushers()`
- **前端调用**: [hula/src/services/matrix/MatrixPushService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixPushService.ts) - `getPushers()`

---

## 设置推送器 / Set Pusher

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/pushers` |
| HTTP 方法 | POST |
| SDK 方法 | `client.setPusher()` |
| SDK 模块 | `matrix-js-sdk/src/push/index.ts` (PushManager) |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `pushkey` | `string` | 是 | 推送密钥 |
| `kind` | `string` | 是 | 推送器类型（如 `http`） |
| `app_id` | `string` | 是 | 应用 ID |
| `app_display_name` | `string` | 否 | 应用显示名 |
| `device_display_name` | `string` | 否 | 设备显示名 |
| `profile_tag` | `string` | 否 | 配置标签 |
| `lang` | `string` | 否 | 语言 |
| `data` | `object` | 是 | 推送器数据（`url` 等） |
| `append` | `boolean` | 否 | 是否追加（默认 true） |

### 请求示例

```typescript
await client.setPusher({
    pushkey: 'token',
    kind: 'http',
    app_id: 'm.id',
    app_display_name: 'Matrix',
    device_display_name: 'iPhone',
    data: {
        url: 'https://push.example.com/_matrix/push'
    }
});
```

### 响应结构

```typescript
interface EmptyObject {}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 设置成功 |
| 400 | 参数错误 |
| 401 | 未认证或 Token 无效 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/push.rs` - `set_pusher()`
- **SDK 封装**: [matrix-js-sdk/src/push/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/push/index.ts) - `PushManager.addPusher()`
- **前端调用**: [hula/src/services/matrix/MatrixPushService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixPushService.ts) - `registerPusher()`

---

## 删除推送器 / Remove Pusher

### 基本信息

| 字段 | 值 |
|------|-----|
| 后端路由 | `/_matrix/client/v3/pushers/set` 或 `/_matrix/client/v3/pushers` |
| HTTP 方法 | POST（设置 kind 为 null） |
| SDK 方法 | `client.removePusher()` |
| SDK 模块 | `matrix-js-sdk/src/push/index.ts` (PushManager) |
| 认证要求 | 是 |

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `pushkey` | `string` | 是 | 推送密钥 |
| `app_id` | `string` | 是 | 应用 ID |

### 响应结构

```typescript
interface EmptyObject {}
```

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 删除成功 |
| 401 | 未认证或 Token 无效 |

### 对应关系

- **后端实现**: `synapse-rust/src/web/routes/push.rs` - `set_pusher()`
- **SDK 封装**: [matrix-js-sdk/src/push/index.ts](file:///Users/ljf/Desktop/hu/matrix-js-sdk/src/push/index.ts) - `PushManager.removePusher()`
- **前端调用**: [hula/src/services/matrix/MatrixPushService.ts](file:///Users/ljf/Desktop/hu/hula/src/services/matrix/MatrixPushService.ts) - `unregisterPusher()`

---

## SDK Manager 导出状态

| Manager | 导出位置 | 状态 |
|---------|----------|------|
| `PushManager` | `matrix-js-sdk/src/push/index.ts` | ✅ 完整 |
| `PushRulesManager` | `matrix-js-sdk/src/push-rules/index.ts` | ⚠️ 薄封装 |

---

## 状态说明

| 状态 | 说明 |
|------|------|
| ✅ 已集成 | 后端路由 + SDK 封装 + 前端接入均已完成 |
| ⚠️ 部分漂移 | 后端可用但 SDK/前端封装有分叉 |
| 🟡 行为不稳定 | 基本可用但存在逻辑疑点 |
| 🔴 未实现/有 bug | 缺少必要实现或存在已知 bug |

### Push 模块当前状态

| 功能 | 状态 | 说明 |
|------|------|------|
| 获取推送规则 | ✅ 已集成 | 完整实现 |
| 设置推送规则 | ✅ 已集成 | 完整实现 |
| 删除推送规则 | ✅ 已集成 | 完整实现 |
| 启用/禁用推送规则 | ✅ 已集成 | 完整实现 |
| 更新推送规则动作 | ✅ 已集成 | 完整实现 |
| 获取推送器 | ✅ 已集成 | 完整实现 |
| 设置推送器 | ✅ 已集成 | 完整实现 |
| 删除推送器 | ✅ 已集成 | 完整实现 |

---

## 已知问题

| 问题 | 位置 | 说明 | 优先级 |
|------|------|------|--------|
| 错误处理分类 | `matrix-js-sdk/src/push/index.ts` | 大量 catch 后 throw，没有分类错误处理 | 🟡 中 |
