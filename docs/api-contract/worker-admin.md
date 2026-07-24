---
module: worker
generated_from: docs/api-contract/generated/modules/worker.json
generated_hash: sha256-4295136a9453bfea377c908f229929d9e16faa707c1e58e3f0af702dddcf1b3d
ledger_schema: 1
last_reviewed: 2026-05-03
---

# Worker Admin 模块契约

> 审查来源: `synapse-rust/src/web/routes/worker.rs`、`synapse-rust/src/worker/types.rs`
> 挂载前缀: `/_synapse/worker/v1`
> 更新日期: 2026-04-27
> 审计状态: ✅ 管理员控制面 13 条 Ledger 契约已与 SDK 绑定；复制协议面 helper 作为额外运维能力保留

## 路由分层

`create_worker_router()` 实际分成两层：

- **管理员控制面**: 始终挂载，走 `admin_auth_middleware`。
- **worker 复制协议面**: 只有 `state.services.config.worker.enabled == true` 时才挂载，走 `replication_http_auth_middleware`。

因此，文档不能把全部端点都视为 `AdminUser` 接口。

## 认证要求

| 路由组                                                                           | 实际认证              |
| -------------------------------------------------------------------------------- | --------------------- |
| 注册 / 查询 / 注销 worker、发送命令、派发任务、统计、选路                        | 管理员鉴权            |
| heartbeat、worker 拉取命令、完成/失败命令、完成/失败任务、连接、复制位置、事件流 | replication HTTP 鉴权 |

## 路由总表

### 管理员控制面

| 方法     | 路径                                                    | 说明                                  | 实际响应                                                             |
| -------- | ------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------- |
| `POST`   | `/_synapse/worker/v1/register`                          | 注册 worker                           | `201` + `WorkerResponse`                                             |
| `GET`    | `/_synapse/worker/v1/workers`                           | 列出活跃 worker                       | `200` + `WorkerResponse[]`                                           |
| `GET`    | `/_synapse/worker/v1/workers/type/{worker_type}`        | 按类型列出 worker                     | `200` + `WorkerResponse[]`                                           |
| `GET`    | `/_synapse/worker/v1/workers/{worker_id}`               | 查询单个 worker                       | `200` + `WorkerResponse`                                             |
| `DELETE` | `/_synapse/worker/v1/workers/{worker_id}`               | 注销 worker                           | `204 No Content`                                                     |
| `POST`   | `/_synapse/worker/v1/workers/{worker_id}/commands`      | 下发命令                              | `201` + `WorkerCommandResponse`                                      |
| `POST`   | `/_synapse/worker/v1/tasks`                             | 派发任务                              | `201` + `WorkerTaskResponse`                                         |
| `GET`    | `/_synapse/worker/v1/tasks`                             | 获取待处理任务                        | `200` + `WorkerTaskResponse[]`                                       |
| `POST`   | `/_synapse/worker/v1/tasks/claim/{worker_id}`           | 为指定 worker 领取下一条 pending task | `200` + `WorkerTaskResponse`                                         |
| `POST`   | `/_synapse/worker/v1/tasks/{task_id}/claim/{worker_id}` | 将指定任务标记为该 worker 认领        | `200` + `{ "status": "claimed" }`                                    |
| `GET`    | `/_synapse/worker/v1/statistics`                        | 获取整体统计                          | `200` + service 直接序列化结果                                       |
| `GET`    | `/_synapse/worker/v1/statistics/types`                  | 获取按类型统计                        | `200` + service 直接序列化结果                                       |
| `GET`    | `/_synapse/worker/v1/select/{task_type}`                | 为任务类型选择 worker                 | `200` + `{ "task_type": string, "selected_worker": string \| null }` |

> `docs/api-contract/generated/modules/worker.json` 当前 `entry_count = 13`，仅统计本节管理员控制面路由。

### Worker 协议面

以下路由仅在 `worker.enabled = true` 时可达：

| 方法   | 路径                                                        | 说明                                      | 实际响应                                                             |
| ------ | ----------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------- |
| `POST` | `/_synapse/worker/v1/workers/{worker_id}/heartbeat`         | worker 心跳上报                           | `{ "status": "ok" }`                                                 |
| `POST` | `/_synapse/worker/v1/workers/{worker_id}/connect`           | 建立 worker 连接                          | `{ "status": "connected" }`                                          |
| `POST` | `/_synapse/worker/v1/workers/{worker_id}/disconnect`        | 断开 worker 连接                          | `{ "status": "disconnected" }`                                       |
| `GET`  | `/_synapse/worker/v1/workers/{worker_id}/commands`          | 拉取待处理命令                            | `200` + `WorkerCommandResponse[]`                                    |
| `POST` | `/_synapse/worker/v1/commands/{command_id}/complete`        | 标记命令完成                              | `{ "status": "completed" }`                                          |
| `POST` | `/_synapse/worker/v1/commands/{command_id}/fail`            | 标记命令失败                              | `{ "status": "failed" }`                                             |
| `POST` | `/_synapse/worker/v1/tasks/{task_id}/complete`              | 标记任务完成                              | `{ "status": "completed" }`                                          |
| `POST` | `/_synapse/worker/v1/tasks/{task_id}/fail`                  | 标记任务失败                              | `{ "status": "failed" }`                                             |
| `GET`  | `/_synapse/worker/v1/replication/{worker_id}/position`      | 查询复制位点，需要 `stream_name` 查询参数 | `{ "worker_id": string, "stream_name": string, "position": number }` |
| `PUT`  | `/_synapse/worker/v1/replication/{worker_id}/{stream_name}` | 更新复制位点                              | `{ "status": "updated" }`                                            |
| `GET`  | `/_synapse/worker/v1/events`                                | 获取自某个 `stream_id` 之后的事件         | `200` + 事件数组                                                     |

## 请求体与稳定响应字段

### `RegisterWorkerBody`

```json
{
    "worker_id": "worker-1",
    "worker_name": "Worker One",
    "worker_type": "frontend",
    "host": "127.0.0.1",
    "port": 8080,
    "config": {},
    "metadata": {},
    "version": "1.0.0"
}
```

- `worker_type` 通过 `WorkerType::from_str()` 校验。
- 当前合法值来自 `src/worker/types.rs`：
    - `master`
    - `frontend`
    - `background`
    - `event_persister`
    - `synchrotron`
    - `federation_sender`
    - `federation_reader`
    - `media_repository`
    - `pusher`
    - `appservice`

### `HeartbeatBody`

```json
{
    "status": "running",
    "load_stats": {
        "cpu_usage": 0.4,
        "memory_usage": 1048576,
        "active_connections": 120,
        "requests_per_second": 35.5,
        "average_latency_ms": 12.4,
        "queue_depth": 3
    }
}
```

- `status` 通过 `WorkerStatus::from_str()` 校验。
- 当前合法值：`starting`、`running`、`stopping`、`stopped`、`error`。

### `SendCommandBody`

```json
{
    "command_type": "rebalance",
    "command_data": { "room_id": "!room:example.com" },
    "priority": 5,
    "max_retries": 3
}
```

### `AssignTaskBody`

```json
{
    "task_type": "media_thumbnail",
    "task_data": { "media_id": "mxc://example.com/abc" },
    "priority": 10,
    "preferred_worker_id": "worker-b"
}
```

### `CompleteTaskBody` / `FailTaskBody`

```json
{ "result": { "ok": true } }
```

```json
{ "error": "failed to process task" }
```

### `StreamPosition`

`PUT /replication/{worker_id}/{stream_name}` 的请求体必须是：

```json
{
    "stream_name": "events",
    "position": 123
}
```

注意：路径里的 `{stream_name}` 已经存在，后端仍然会再读取 body 中的 `position` 字段；body 里的 `stream_name` 没有被用于路由选择。

### `WorkerResponse`

```json
{
    "id": 1,
    "worker_id": "worker-1",
    "worker_name": "Worker One",
    "worker_type": "frontend",
    "host": "127.0.0.1",
    "port": 8080,
    "status": "running",
    "last_heartbeat_ts": 1710000000000,
    "started_ts": 1710000000000
}
```

### `WorkerCommandResponse`

```json
{
    "command_id": "cmd-1",
    "target_worker_id": "worker-1",
    "command_type": "rebalance",
    "status": "pending",
    "created_ts": 1710000000000
}
```

### `WorkerTaskResponse`

```json
{
    "task_id": "task-1",
    "task_type": "media_thumbnail",
    "status": "pending",
    "assigned_worker_id": "worker-1"
}
```

## 真实业务规则

- `GET /workers` 调用的是 `worker_manager.get_active()`，不是“历史全量 worker 列表”。
- `GET /workers/type/{worker_type}` 会先解析 `worker_type`，非法值直接 `400`。
- `GET /tasks` 与 `GET /workers/{worker_id}/commands` 的 `limit` 查询参数默认都是 `100`。
- `GET /events` 只消费 `stream_id` 查询参数，默认 `0`，内部固定 `limit = 100`，当前没有开放外部 `limit` 参数。
- `claim_next_task` 属于管理员控制面，不是 worker 协议面。
- `connect` / `disconnect` / `heartbeat` / 命令完成失败 / 任务完成失败都不需要 `AdminUser`，而是依赖 replication 鉴权中间件。

## SDK 对齐状态

- **封装 Manager**: `WorkerAdminManager`
- **挂载位置**: `MatrixClient.getWorkerAdminManager()`
- **路径绑定**: 已通过 `WorkerAdminPathPattern` 绑定所有 13 条控制面路由。
- **状态**: ✅ 100% 完善

## 覆盖率口径

- **后端 Ledger 路由数**: 13
- **SDK 已封装路由数**: 13
- **已绑定生成路由模板**: 13
- **契约覆盖率**: 100%

## 错误与兼容性

| 场景                                  | 实际返回                      |
| ------------------------------------- | ----------------------------- |
| 非法 `worker_type`                    | `400`                         |
| 非法 `status`                         | `400`                         |
| worker 未找到                         | `404`                         |
| 未通过管理员鉴权                      | `401`/`403`，取决于中间件实现 |
| `worker.enabled = false` 时访问协议面 | 路由未挂载，返回 `404`        |

- 当前文档只承诺路由层显式可见的字段，不把 `WorkerInfo` 内部的 `stopped_ts`、`config`、`metadata`、`version` 自动外推到 `WorkerResponse`，因为这些字段没有出现在实际响应 DTO 中。
- 协议面与控制面虽然共用 `/_synapse/worker/v1` 前缀，但认证方式不同，前端或运维工具不能混用 token。

## 版本变更记录

### 2026-04-27

- 修正文档将全部 worker 路由误写为管理员接口的问题。
- 明确 `worker.enabled` 对复制协议面是否可达的条件挂载行为。
- 修正复制位点接口方法，实际为 `GET /position` 与 `PUT /replication/{worker_id}/{stream_name}`，不存在文档旧版所写的 `GET /replication/{worker_id}/{stream_name}`。
- 收敛事件流查询参数描述，确认仅支持 `stream_id`，且服务端固定拉取 `100` 条。

### 2026-05-11

- 明确 `generated/modules/worker.json` 的 13 条契约仅覆盖管理员控制面。
- SDK 管理员控制面方法全部绑定到生成 `route-table`，覆盖率更新为 100%。

## 代码定位

- 路由与处理器: `synapse-rust/src/web/routes/worker.rs`
- 类型定义: `synapse-rust/src/worker/types.rs`
