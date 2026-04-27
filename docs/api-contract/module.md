# Module System API 契约文档

> 后端代码: `synapse-rust/src/web/routes/module.rs`  
> 装配入口: `synapse-rust/src/web/routes/admin/mod.rs`  
> 更新日期: 2026-04-27  
> 挂载版本: `v1` (Admin)

## 一、模块概述

### 1.1 功能描述

Module System API 提供服务器模块管理功能，支持动态加载和配置模块。

### 1.2 路由前缀

- `/_synapse/admin/v1/modules`

### 1.3 认证要求

- 所有端点需要 `AdminUser`

## 二、端点详情

### 2.1 查询所有模块

**路径**: `GET /_synapse/admin/v1/modules`  
**认证**: `AdminUser`

**响应**: `200 OK`
```typescript
interface ModulesResponse {
  modules: Array<{
    name: string;
    type: string;
    enabled: boolean;
    version: string;
  }>;
}
```

### 2.2 创建模块

**路径**: `POST /_synapse/admin/v1/modules`  
**认证**: `AdminUser`

**请求体**:
```json
{
  "name": "spam_checker",
  "type": "spam_check",
  "config": {}
}
```

**响应**: `201 Created`

### 2.3 按类型查询模块

**路径**: `GET /_synapse/admin/v1/modules/type/{module_type}`  
**认证**: `AdminUser`

**响应**: `200 OK`

### 2.4 查询单个模块

**路径**: `GET /_synapse/admin/v1/modules/{module_name}`  
**认证**: `AdminUser`

**响应**: `200 OK`

### 2.5 删除模块

**路径**: `DELETE /_synapse/admin/v1/modules/{module_name}`  
**认证**: `AdminUser`

**响应**: `200 OK`

### 2.6 更新模块配置

**路径**: `PUT /_synapse/admin/v1/modules/{module_name}/config`  
**认证**: `AdminUser`

**响应**: `200 OK`

### 2.7 启用模块

**路径**: `POST /_synapse/admin/v1/modules/{module_name}/enable`  
**认证**: `AdminUser`

**响应**: `200 OK`

### 2.8 垃圾检查

**路径**: `POST /_synapse/admin/v1/modules/check_spam`  
**认证**: `AdminUser`

**请求体**:
```json
{
  "event": {}
}
```

**响应**: `200 OK`
```json
{
  "is_spam": false
}
```

### 2.9 第三方规则检查

**路径**: `POST /_synapse/admin/v1/modules/check_third_party_rule`  
**认证**: `AdminUser`

**响应**: `200 OK`

### 2.10 查询垃圾检查结果

**路径**: `GET /_synapse/admin/v1/modules/spam_check/{event_id}`  
**认证**: `AdminUser`

**响应**: `200 OK`

### 2.11 按发送者查询垃圾检查

**路径**: `GET /_synapse/admin/v1/modules/spam_check/sender/{sender}`  
**认证**: `AdminUser`

**响应**: `200 OK`

### 2.12 查询第三方规则

**路径**: `GET /_synapse/admin/v1/modules/third_party_rule/{event_id}`  
**认证**: `AdminUser`

**响应**: `200 OK`

### 2.13 查询模块日志

**路径**: `GET /_synapse/admin/v1/modules/logs/{module_name}`  
**认证**: `AdminUser`

**响应**: `200 OK`

## 三、SDK 对齐状态

### 3.1 封装覆盖率

- **总端点数**: 13
- **已封装**: 0
- **覆盖率**: 0%

## 四、变更历史

| 日期 | 变更 | 影响 |
|------|------|------|
| 2026-04-27 | 初版 | - |
