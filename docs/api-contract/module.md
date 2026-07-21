---
module: module
generated_from: docs/api-contract/generated/modules/module.json
generated_hash: sha256-7103a3ba496ea7cdcef9776c0c31a8fa9a87dc2538750b0bed264f3f938a3531
ledger_schema: 1
last_reviewed: 2026-05-11
---

# Module System API 契约文档

> 后端代码: `synapse-rust/src/web/routes/module.rs`  
> 装配入口: `synapse-rust/src/web/routes/admin/mod.rs`  
> SDK 入口: `src/admin/index.ts`  
> 更新日期: 2026-05-11  
> 挂载版本: `v1` (Admin)

## 一、当前审计结论

- `generated/modules/module.json` 当前记录 **27** 条 admin 路由，不是旧文档中的 `13` 条。
- 这些路由并不只包含 `/modules/*`，还包括模块系统挂出的 `account_validity`、`password_auth_providers`、`presence_routes`、`media_callbacks`、`rate_limit_callbacks`、`account_data_callbacks`。
- SDK 并没有单独的 `ModuleManager`；真实封装落在 `AdminManager`。
- 本轮已补齐 `AdminManager` 对全部 27 条后端路由的手写 wrapper，并绑定 `ModulePathPattern`。
- 已修正两个真实 SDK 漂移：
    - `updateModuleConfig()` 使用 `PUT /modules/{module_name}/config`，body 为 `{ config }`
    - `setModuleEnabled()` 使用 `{ is_enabled }`，不是 `{ enabled }`

## 二、认证要求

- 所有端点需要 `AdminUser`

## 三、路由族与 SDK 对齐

### 3.1 modules 主路由族

| 方法   | 路径                                                     | SDK 方法                           |
| ------ | -------------------------------------------------------- | ---------------------------------- |
| GET    | `/_synapse/admin/v1/modules`                             | `listModules()`                    |
| POST   | `/_synapse/admin/v1/modules`                             | `createModule()`                   |
| GET    | `/_synapse/admin/v1/modules/type/{module_type}`          | `listModulesByType()`              |
| GET    | `/_synapse/admin/v1/modules/{module_name}`               | `getModule()`                      |
| PUT    | `/_synapse/admin/v1/modules/{module_name}/config`        | `updateModuleConfig()`             |
| POST   | `/_synapse/admin/v1/modules/{module_name}/enable`        | `setModuleEnabled()`               |
| DELETE | `/_synapse/admin/v1/modules/{module_name}`               | `deleteModule()`                   |
| POST   | `/_synapse/admin/v1/modules/check_spam`                  | `checkModuleSpam()`                |
| POST   | `/_synapse/admin/v1/modules/check_third_party_rule`      | `checkModuleThirdPartyRule()`      |
| GET    | `/_synapse/admin/v1/modules/spam_check/{event_id}`       | `getModuleSpamCheckResult()`       |
| GET    | `/_synapse/admin/v1/modules/spam_check/sender/{sender}`  | `listModuleSpamChecksBySender()`   |
| GET    | `/_synapse/admin/v1/modules/third_party_rule/{event_id}` | `getModuleThirdPartyRuleResults()` |
| GET    | `/_synapse/admin/v1/modules/logs/{module_name}`          | `getModuleLogs()`                  |

### 3.2 module 扩展 admin 路由族

| 方法 | 路径                                                  | SDK 方法                       |
| ---- | ----------------------------------------------------- | ------------------------------ |
| POST | `/_synapse/admin/v1/account_validity`                 | `createAccountValidity()`      |
| GET  | `/_synapse/admin/v1/account_validity/{user_id}`       | `getAccountValidity()`         |
| POST | `/_synapse/admin/v1/account_validity/{user_id}/renew` | `renewAccountValidity()`       |
| GET  | `/_synapse/admin/v1/password_auth_providers`          | `listPasswordAuthProviders()`  |
| POST | `/_synapse/admin/v1/password_auth_providers`          | `createPasswordAuthProvider()` |
| GET  | `/_synapse/admin/v1/presence_routes`                  | `listPresenceRoutes()`         |
| POST | `/_synapse/admin/v1/presence_routes`                  | `createPresenceRoute()`        |
| GET  | `/_synapse/admin/v1/media_callbacks`                  | `listMediaCallbacks()`         |
| GET  | `/_synapse/admin/v1/media_callbacks/{callback_type}`  | `listMediaCallbacksByType()`   |
| POST | `/_synapse/admin/v1/media_callbacks`                  | `createMediaCallback()`        |
| GET  | `/_synapse/admin/v1/rate_limit_callbacks`             | `listRateLimitCallbacks()`     |
| POST | `/_synapse/admin/v1/rate_limit_callbacks`             | `createRateLimitCallback()`    |
| GET  | `/_synapse/admin/v1/account_data_callbacks`           | `listAccountDataCallbacks()`   |
| POST | `/_synapse/admin/v1/account_data_callbacks`           | `createAccountDataCallback()`  |

## 四、关键请求/响应口径

```typescript
interface CreateModuleBody {
    module_name: string;
    module_type: string;
    version: string;
    description?: string;
    is_enabled?: boolean;
    priority?: number;
    config?: Record<string, unknown>;
}
```

```typescript
interface UpdateModuleConfigBody {
    config: Record<string, unknown>;
}
```

```typescript
interface EnableModuleBody {
    is_enabled: boolean;
}
```

```typescript
interface ListModulesResponse {
    modules: Array<Record<string, unknown>>;
    next_batch: string | null;
}
```

补充说明:

- `listModulesByType()`、`listPasswordAuthProviders()`、`listPresenceRoutes()`、`listMediaCallbacks()` 等多个列表端点返回的是数组，不是 `{ items: [] }` 包装对象。
- `DELETE /modules/{module_name}` 后端返回 `204 No Content`，SDK `deleteModule()` 保持 `Promise<void>`。
- `check_spam` 与 `check_third_party_rule` 都要求完整事件上下文，不是旧文档里的简化 `{ event: {} }`。

## 五、SDK 对齐状态

- **总端点数**: 27
- **已封装**: 27
- **覆盖率**: 100%
- **封装位置**: `src/admin/index.ts`
- **路径绑定**: 模块系统相关方法使用 `ModulePathPattern`
- **验证状态**: `spec/unit/admin-new-endpoints.spec.ts`

## 六、变更历史

| 日期       | 变更                                                                                                       | 影响                    |
| ---------- | ---------------------------------------------------------------------------------------------------------- | ----------------------- |
| 2026-05-11 | 按后端 ledger 重写为 27 条 admin 路由口径，补充 `AdminManager` 实际封装映射，并修正配置更新/启用请求体语义 | 修复长期文档与 SDK 漂移 |
| 2026-04-27 | 初版                                                                                                       | -                       |
