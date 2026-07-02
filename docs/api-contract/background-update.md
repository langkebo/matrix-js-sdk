---
module: background_update
generated_from: docs/api-contract/generated/modules/background_update.json
generated_hash: sha256-24e2e853924f5db3efaf04685a486430c3f8894bb528489656672f01ea11f2ff
ledger_schema: 1
last_reviewed: 2026-05-11
---

# Background Update API 契约文档

> 后端代码: `synapse-rust/src/web/routes/background_update.rs`  
> 装配入口: `synapse-rust/src/web/routes/admin/mod.rs`  
> SDK 入口: `src/background-update/index.ts`  
> 更新日期: 2026-05-11  
> 挂载版本: `v1` (Admin)

## 一、当前审计结论

- `generated/modules/background_update.json` 当前记录 **19** 条后台更新管理路由。
- 后端实际支持:
  - 任务列表分页
  - 创建任务
  - 按状态统计
  - 单任务读取 / 启动 / 进度推进 / 完成 / 失败 / 取消 / 删除
  - 历史记录与统计信息查询
- SDK 现已提供 `BackgroundUpdateManager`，并通过生成的 `BackgroundUpdatePathPattern` 绑定所有管理端路径。
- 旧文档中 “10 条端点 / 0% 覆盖率 / count 返回 `{ count }` / pending 返回字符串数组” 均已过期，不再准确。

## 二、路由前缀与认证

- `/_synapse/admin/v1/background_updates`
- 所有端点需要 `AdminUser`

## 三、核心请求与响应形状

```typescript
interface CreateBackgroundUpdateBody {
    job_name: string;
    job_type: string;
    description?: string;
    table_name?: string;
    column_name?: string;
    total_items?: number;
    batch_size?: number;
    sleep_ms?: number;
    depends_on?: string[];
    metadata?: Record<string, unknown>;
}
```

```typescript
interface BackgroundUpdateRecord {
    job_name: string;
    job_type: string;
    description?: string | null;
    table_name?: string | null;
    status: string;
    progress: Record<string, unknown> | number | null;
    total_items: number;
    processed_items: number;
    created_ts: number;
    started_ts?: number | null;
    completed_ts?: number | null;
    error_message?: string | null;
    retry_count: number;
}
```

```typescript
interface BackgroundUpdateHistoryRecord {
    id: number;
    job_name: string;
    execution_start_ts: number;
    execution_end_ts?: number | null;
    status: string;
    items_processed: number;
    error_message?: string | null;
}
```

```typescript
interface BackgroundUpdateStatsRecord {
    id: number;
    job_name: string;
    total_updates: number;
    completed_updates: number;
    failed_updates: number;
    last_run_ts?: number | null;
    next_run_ts?: number | null;
    average_duration_ms: number;
    created_ts: number;
    updated_ts: number;
}
```

```typescript
interface BackgroundUpdateStatusResponse {
    pending_count: number;
    running_count: number;
    completed_count: number;
    failed_count: number;
    total_count: number;
    current_update?: BackgroundUpdateRecord | null;
}
```

补充说明:

- `GET /background_updates` 返回 `{ updates, next_batch }`，不是单纯数组。
- `GET /background_updates/count` 返回 `{ total_updates }`，不是旧文档中的 `{ count }`。
- `GET /background_updates/pending` 与 `GET /background_updates/running` 都返回 `BackgroundUpdateRecord[]`，不是字符串列表包装对象。
- `GET /background_updates/next` 返回 `BackgroundUpdateRecord | null`。
- `POST /background_updates/retry_failed` 返回 `{ retried_count }`。
- `POST /background_updates/cleanup_locks` 返回 `{ cleaned_count }`。
- `GET /background_updates/status/{status}/count` 返回 `{ status, count }`。
- `DELETE /background_updates/{job_name}` 返回 `204 No Content`。

## 四、路由与 SDK 对齐表

| 方法 | 路径 | SDK 方法 |
| ---- | ---- | -------- |
| GET | `/_synapse/admin/v1/background_updates` | `listBackgroundUpdates()` |
| POST | `/_synapse/admin/v1/background_updates` | `createBackgroundUpdate()` |
| POST | `/_synapse/admin/v1/background_updates/cleanup_locks` | `cleanupLocks()` |
| GET | `/_synapse/admin/v1/background_updates/count` | `getUpdateCount()` |
| GET | `/_synapse/admin/v1/background_updates/next` | `getNextPendingUpdate()` |
| GET | `/_synapse/admin/v1/background_updates/pending` | `listPendingUpdates()` |
| POST | `/_synapse/admin/v1/background_updates/retry_failed` | `retryFailedUpdates()` |
| GET | `/_synapse/admin/v1/background_updates/running` | `listRunningUpdates()` |
| GET | `/_synapse/admin/v1/background_updates/stats` | `getStats()` |
| GET | `/_synapse/admin/v1/background_updates/status` | `getStatus()` |
| GET | `/_synapse/admin/v1/background_updates/status/{status}/count` | `countByStatus()` |
| GET | `/_synapse/admin/v1/background_updates/{job_name}` | `getUpdate()` |
| DELETE | `/_synapse/admin/v1/background_updates/{job_name}` | `deleteUpdate()` |
| POST | `/_synapse/admin/v1/background_updates/{job_name}/start` | `startUpdate()` |
| POST | `/_synapse/admin/v1/background_updates/{job_name}/progress` | `updateProgress()` |
| POST | `/_synapse/admin/v1/background_updates/{job_name}/complete` | `completeUpdate()` |
| POST | `/_synapse/admin/v1/background_updates/{job_name}/fail` | `failUpdate()` |
| POST | `/_synapse/admin/v1/background_updates/{job_name}/cancel` | `cancelUpdate()` |
| GET | `/_synapse/admin/v1/background_updates/{job_name}/history` | `getHistory()` |

## 五、SDK 对齐状态

- **总端点数**: 19
- **已封装**: 19
- **覆盖率**: 100%
- **路径绑定**: `src/background-update/index.ts` 使用生成的 `BackgroundUpdatePathPattern`
- **客户端扩展**: `MatrixClient#getBackgroundUpdateManager()`
- **验证状态**: `spec/unit/background-update.spec.ts`

## 六、变更历史

| 日期       | 变更 | 影响 |
| ---------- | ---- | ---- |
| 2026-05-11 | 按后端真实 19 条路由重写文档，并补齐 `BackgroundUpdateManager`、测试与路径绑定 | 修复旧文档长期漂移 |
| 2026-04-27 | 初版 | -    |
