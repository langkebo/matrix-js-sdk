---
module: telemetry
generated_from: docs/api-contract/generated/modules/telemetry.json
generated_hash: sha256-8a580ec273dcffee9744d8be5082788b98cdc758080205294d9ec38ff27816db
ledger_schema: 1
last_reviewed: 2026-05-11
---

# Telemetry API 契约文档

> 后端代码: `synapse-rust/src/web/routes/telemetry.rs`
> 挂载前缀: `/_synapse/admin/v1`
> 对应 SDK 模块: `src/telemetry/index.ts`

## 本轮复核结论

- 后端 `telemetry.rs` 暴露 6 条 admin telemetry 路由，全部要求 `AdminUser`。
- SDK 当前的 [TelemetryManager](file:///Users/ljf/Desktop/hu_ts/matrix-js-sdk/src/telemetry/index.ts) 同时承担两层职责：
    - 本地客户端埋点队列与 usage stats
    - 后端 admin telemetry wrapper
- 本轮已补齐 6 条后端 telemetry 端点封装，不再是旧文档里“已封装 0 / 覆盖率 0%”的状态。

## 路由与 SDK 对齐

| 方法   | 路径                                                 | 后端响应                                                                        | SDK 方法                                     |
| ------ | ---------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------- |
| `GET`  | `/_synapse/admin/v1/telemetry/status`                | 遥测开关、trace/metrics 开关、服务名、采样率、导出配置                          | `TelemetryManager.getServerStatus()`         |
| `GET`  | `/_synapse/admin/v1/telemetry/attributes`            | `{ attributes: Record<string, string> }`                                        | `TelemetryManager.getServerAttributes()`     |
| `GET`  | `/_synapse/admin/v1/telemetry/metrics`               | metrics 汇总统计而不是明细数组                                                  | `TelemetryManager.getServerMetricsSummary()` |
| `GET`  | `/_synapse/admin/v1/telemetry/alerts`                | `{ alerts: TelemetryAlert[] }`，支持 `status` / `severity` / `refresh` 查询参数 | `TelemetryManager.getServerAlerts()`         |
| `POST` | `/_synapse/admin/v1/telemetry/alerts/{alert_id}/ack` | 返回被确认后的 alert 对象                                                       | `TelemetryManager.acknowledgeServerAlert()`  |
| `GET`  | `/_synapse/admin/v1/telemetry/health`                | 综合健康结果，含 `status`、`checks`、`database`、`alerts`                       | `TelemetryManager.getServerHealth()`         |

## 真实返回结构

### `GET /telemetry/status`

```typescript
interface ServerTelemetryStatus {
    enabled: boolean;
    trace_enabled: boolean;
    metrics_enabled: boolean;
    service_name: string;
    service_version: string;
    sampling_ratio: number;
    export_config: {
        otlp_endpoint?: string | null;
        prometheus_port?: number | null;
        prometheus_path?: string | null;
        batch_export: boolean;
    };
}
```

### `GET /telemetry/attributes`

```typescript
interface ServerTelemetryAttributes {
    attributes: Record<string, string>;
}
```

### `GET /telemetry/metrics`

```typescript
interface ServerTelemetryMetricsSummary {
    total_metrics: number;
    total_counters: number;
    total_gauges: number;
    total_histograms: number;
    rendered_bytes: number;
    snapshot_ts: number;
}
```

### `GET /telemetry/alerts`

```typescript
interface ServerTelemetryAlert {
    alert_id: string;
    alert_key: string;
    severity: string;
    status: string;
    title?: string;
    message?: string;
    created_at_ms?: number;
    updated_at_ms?: number;
    acknowledged_by?: string | null;
    acknowledged_at_ms?: number | null;
    metadata?: Record<string, unknown>;
}
```

### `GET /telemetry/health`

```typescript
interface ServerTelemetryHealth {
    status: string;
    service: string;
    trace_enabled: boolean;
    metrics_enabled: boolean;
    checks: Array<Record<string, unknown>>;
    database: Record<string, unknown>;
    alerts: ServerTelemetryAlert[];
}
```

## SDK 说明

- `TelemetryManager` 的原有本地能力仍保留：
    - `track()`
    - `trackMessageSent()`
    - `trackMessageReceived()`
    - `trackRoomJoined()`
    - `trackCall()`
    - `trackMediaUploaded()`
    - `flush()`
    - `getUsageStats()`
- Admin telemetry wrapper 统一通过 `AdminPrefix.V1` 发起请求。
- `src/telemetry/index.ts` 现已绑定生成的 `TelemetryPathPattern`，避免 admin telemetry 路径再次手写漂移。

## 测试对齐

- `spec/unit/telemetry.spec.ts` 已覆盖：
    - `getServerStatus()`
    - `getServerAttributes()`
    - `getServerMetricsSummary()`
    - `getServerAlerts()` 的查询参数透传
    - `acknowledgeServerAlert()` 的路径参数编码
    - `getServerHealth()`

## 封装覆盖率

- **后端路由总数**: 6
- **SDK 主路径覆盖**: 6/6
- **已绑定生成路由模板**: 6/6
- **契约覆盖率**: 100%
