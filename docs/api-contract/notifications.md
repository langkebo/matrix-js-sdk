---
module: push_notification
generated_from: docs/api-contract/generated/modules/push_notification.json
generated_hash: sha256-84969ea597fef70a656545f840518e2dc40fa45bf3edd882c6875962eb78e3ed
ledger_schema: 1
last_reviewed: 2026-05-03
---

# 推送通知契约

> 审查来源: `synapse-rust/src/web/routes/push_notification.rs`

## 真实后端路由

| 方法 | 路径                               | 说明         | 认证 |
| ---- | ---------------------------------- | ------------ | ---- |
| GET  | `/_matrix/client/r0/notifications` | 获取通知历史 | 用户 |
| GET  | `/_matrix/client/v3/notifications` | 获取通知历史 | 用户 |

## SDK 对齐状态

| 端点                 | SDK Manager    | 方法                 | 状态      |
| -------------------- | -------------- | -------------------- | --------- |
| `GET /notifications` | `MatrixClient` | `getNotifications()` | ✅ 已封装 |

## 常见状态码

| 状态码 | 说明                     |
| ------ | ------------------------ |
| `200`  | 请求成功                 |
| `400`  | 分页参数或过滤条件不合法 |
| `401`  | Token 无效或缺失         |
| `403`  | 无权查看通知流           |
| `404`  | 分页锚点或关联事件不存在 |
| `429`  | 触发限流                 |

## 错误语义对齐（BaseManager）

| 场景                     | HTTP / errcode                         | SDK 统一错误类型 | 调用方建议                           |
| ------------------------ | -------------------------------------- | ---------------- | ------------------------------------ |
| 未认证或 token 失效      | `401` / `M_UNKNOWN_TOKEN`              | `AuthError`      | 引导重新登录                         |
| 查询参数不合法           | `400` / `M_BAD_JSON` `M_INVALID_PARAM` | `ApiError`       | 修正 `from`、`limit`、`only` 后重试  |
| 权限不足                 | `403` / `M_FORBIDDEN`                  | `ApiError`       | 提示用户当前账号无权访问通知历史     |
| 分页锚点或关联数据不存在 | `404` / `M_NOT_FOUND`                  | `NotFoundError`  | 清空本地分页游标并重新拉取第一页     |
| 限流或短暂服务异常       | `429` / `M_LIMIT_EXCEEDED`             | `RetryableError` | 使用退避重试                         |
| 其他 API 错误            | 其他 `4xx/5xx`                         | `ApiError`       | 按 `code` 与 `statusCode` 做兜底处理 |

## 典型 errcode

| errcode            | 常见 HTTP | 说明                               |
| ------------------ | --------- | ---------------------------------- |
| `M_UNKNOWN_TOKEN`  | `401`     | access token 无效、过期或缺失      |
| `M_BAD_JSON`       | `400`     | 通知查询参数结构不符合接口要求     |
| `M_INVALID_PARAM`  | `400`     | `limit`、`from` 或 `only` 参数非法 |
| `M_FORBIDDEN`      | `403`     | 无权读取通知历史                   |
| `M_NOT_FOUND`      | `404`     | 分页游标或关联通知事件不存在       |
| `M_LIMIT_EXCEEDED` | `429`     | 通知查询触发限流                   |
