# Telemetry API 契约文档

> 后端代码: `synapse-rust/src/web/routes/telemetry.rs`  
> 装配入口: `synapse-rust/src/web/routes/admin/mod.rs`  
> 更新日期: 2026-04-27  
> 挂载版本: `v1` (Admin)

## 一、模块概述

### 1.1 功能描述

Telemetry API 提供服务器遥测监控功能，包括状态、指标、告警和健康检查。

### 1.2 路由前缀

- `/_synapse/admin/v1/telemetry/*`

### 1.3 认证要求

- 所有端点需要 `AdminUser`

## 二、端点详情

### 2.1 查询遥测状态

**路径**: `GET /_synapse/admin/v1/telemetry/status`  
**认证**: `AdminUser`

**响应**: `200 OK`
```typescript
interface TelemetryStatus {
  enabled: boolean;
  collection_interval_ms: number;
  last_collection_ts: number;
}
```

### 2.2 查询遥测属性

**路径**: `GET /_synapse/admin/v1/telemetry/attributes`  
**认证**: `AdminUser`

**响应**: `200 OK`
```typescript
interface TelemetryAttributes {
  server_name: string;
  server_version: string;
  python_version: string;
  database_engine: string;
  database_version: string;
}
```

### 2.3 查询遥测指标

**路径**: `GET /_synapse/admin/v1/telemetry/metrics`  
**认证**: `AdminUser`

**响应**: `200 OK`
```typescript
interface TelemetryMetrics {
  metrics: Array<{
    name: string;
    value: number;
    timestamp: number;
    labels?: Record<string, string>;
  }>;
}
```

### 2.4 查询告警

**路径**: `GET /_synapse/admin/v1/telemetry/alerts`  
**认证**: `AdminUser`

**响应**: `200 OK`
```typescript
interface TelemetryAlerts {
  alerts: Array<{
    id: string;
    severity: string;
    message: string;
    created_ts: number;
    acknowledged: boolean;
  }>;
}
```

### 2.5 确认告警

**路径**: `POST /_synapse/admin/v1/telemetry/alerts/{alert_id}/ack`  
**认证**: `AdminUser`

**响应**: `200 OK`
```json
{}
```

### 2.6 健康检查

**路径**: `GET /_synapse/admin/v1/telemetry/health`  
**认证**: `AdminUser`

**响应**: `200 OK`
```typescript
interface HealthStatus {
  healthy: boolean;
  checks: Array<{
    name: string;
    status: string;
    message?: string;
  }>;
}
```

## 三、SDK 对齐状态

### 3.1 封装覆盖率

- **总端点数**: 6
- **已封装**: 0
- **覆盖率**: 0%

## 四、变更历史

| 日期 | 变更 | 影响 |
|------|------|------|
| 2026-04-27 | 初版 | - |
