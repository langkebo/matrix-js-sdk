---
module: feature_flags
generated_from: docs/api-contract/generated/modules/feature_flags.json
generated_hash: sha256-58e1593f3454060d99dcd0a33bbb8c98e5e297633fe84a395f0d27baa0f5bd68
ledger_schema: 1
last_reviewed: 2026-05-03
---

# Feature Flags API 契约文档

> 后端代码: `synapse-rust/src/web/routes/feature_flags.rs`  
> 装配入口: `synapse-rust/src/web/routes/admin/mod.rs`  
> 更新日期: 2026-04-27  
> 挂载版本: `v1` (Admin)

## 一、模块概述

### 1.1 功能描述

Feature Flags API 提供特性开关管理功能，用于动态控制功能启用/禁用。

### 1.2 路由前缀

- `/_synapse/admin/v1/feature-flags`

### 1.3 认证要求

- 所有端点需要 `AdminUser`

## 二、端点详情

### 2.1 查询所有特性开关

**路径**: `GET /_synapse/admin/v1/feature-flags`  
**认证**: `AdminUser`

**响应**: `200 OK`

```typescript
interface FeatureFlagsResponse {
    flags: Array<{
        name: string;
        enabled: boolean;
        description: string;
        created_ts: number;
        updated_ts: number;
    }>;
}
```

### 2.2 查询单个特性开关

**路径**: `GET /_synapse/admin/v1/feature-flags/{flag_name}`  
**认证**: `AdminUser`

**响应**: `200 OK`

```typescript
interface FeatureFlag {
    name: string;
    enabled: boolean;
    description: string;
    created_ts: number;
    updated_ts: number;
}
```

### 2.3 更新特性开关

**路径**: `PUT /_synapse/admin/v1/feature-flags/{flag_name}`  
**认证**: `AdminUser`

**请求体**:

```json
{
    "enabled": true
}
```

**响应**: `200 OK`

```json
{}
```

### 2.4 删除特性开关

**路径**: `DELETE /_synapse/admin/v1/feature-flags/{flag_name}`  
**认证**: `AdminUser`

**响应**: `200 OK`

```json
{}
```

## 三、SDK 对齐状态

### 3.1 封装覆盖率

- **总端点数**: 4
- **已封装**: 0
- **覆盖率**: 0%

## 四、变更历史

| 日期       | 变更 | 影响 |
| ---------- | ---- | ---- |
| 2026-04-27 | 初版 | -    |
