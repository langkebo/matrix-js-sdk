---
module: telemetry
generated_from: docs/api-contract/generated/modules/telemetry.json
generated_hash: sha256-dbabbf28c1d9378806b7e6cb57543775a19ba467e4ad75112687f16cd1e062b3
ledger_schema: 4
last_reviewed: 2026-05-11
---

# Telemetry API 契约文档

> 后端代码: `synapse-rust/synapse-web/src/routes/telemetry.rs`
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

## 实现口径补充（2026-10-17 后端契约回灌）

### `/telemetry/metrics` 是 JSON 摘要，不是 Prometheus 抓取点

该端点返回给人看的 JSON 摘要；Prometheus 抓取走独立端口 / 路径（见下文
`prometheus_scrape_target`），不要把本端点配置为 scrape target。

### `appservice_scheduler` 的 12 个子字段

`GET /_synapse/admin/v1/telemetry/metrics` 顶层在 `total_*` / `rendered_bytes` / `snapshot_ts`
之外，还带一个 `appservice_scheduler` 对象：

| 字段                                 | 含义                 |
| ------------------------------------ | -------------------- |
| `total_services`                     | 应用服务总数         |
| `scheduler_available_services`       | 参与调度的可用服务数 |
| `services_in_backoff`                | 处于退避状态的服务数 |
| `services_capacity_limited`          | 受容量限制的服务数   |
| `services_with_pending_transactions` | 有待推送事务的服务数 |
| `total_pending_events`               | 待推送事件总数       |
| `total_pending_transactions`         | 待推送事务总数       |
| `total_success_count`                | 累计成功次数         |
| `total_failure_count`                | 累计失败次数         |
| `total_backoff_count`                | 累计退避次数         |
| `total_capacity_limited_count`       | 累计容量受限次数     |
| `total_in_flight_count`              | 当前在途请求数       |

上述 12 个字段在 SDK 的 `ServerTelemetryMetricsSummary` 中尚未声明，按需读取时不要假设
`appservice_scheduler` 一定存在（未启用应用服务时可能缺省）。

### `prometheus_scrape_target`

同一响应可带 `prometheus_scrape_target`：

```json
{ "port": 9000, "path": "/metrics", "note": "..." }
```

- `null` 表示独立抓取端口未监听（`telemetry.prometheus.enabled = false`，默认关闭）。
- 非 `null` 时 `port` 为监听端口，`path` 为抓取路径；`note` 是说明文本。
- 它描述的是抓取目标，不是本端点的响应内容。

### `rendered_bytes` 的语义

`rendered_bytes` 是 Prometheus 文本格式的**字节数**，不是指标条数，也不包含文本本身。
指标条数看 `total_metrics` / `total_counters` / `total_gauges` / `total_histograms`。
