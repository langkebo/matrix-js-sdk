---
module: search
generated_from: docs/api-contract/generated/modules/search.json
generated_hash: sha256-eaab76c60ce7c245c8e47fbecb46119ad672463b181838528f2bc5d3612ed6bc
ledger_schema: 1
last_reviewed: 2026-05-03
---

# 搜索契约

> 审查来源: `synapse-rust/src/web/routes/handlers/search.rs`

## 真实后端路由

| 方法 | 路径                        | 说明     | 认证 |
| ---- | --------------------------- | -------- | ---- |
| POST | `/_matrix/client/r0/search` | 全局搜索 | 用户 |
| POST | `/_matrix/client/v3/search` | 全局搜索 | 用户 |

## SDK 对齐状态

| 端点           | SDK Manager    | 方法       | 状态      |
| -------------- | -------------- | ---------- | --------- |
| `POST /search` | `MatrixClient` | `search()` | ✅ 已封装 |

## 常见状态码

| 状态码 | 说明                                   |
| ------ | -------------------------------------- |
| `200`  | 请求成功                               |
| `400`  | 搜索词为空、过滤器超限或请求体格式非法 |
| `401`  | Token 无效或缺失                       |
| `403`  | 无权搜索目标房间或查看用户资料         |
| `404`  | 房间或事件不存在                       |
| `429`  | 触发限流                               |

## 错误语义对齐（BaseManager）

| 场景                   | HTTP / errcode                         | SDK 统一错误类型 | 调用方建议                               |
| ---------------------- | -------------------------------------- | ---------------- | ---------------------------------------- |
| 未认证或 token 失效    | `401` / `M_UNKNOWN_TOKEN`              | `AuthError`      | 引导重新登录或刷新凭据                   |
| 搜索条件不合法         | `400` / `M_BAD_JSON` `M_INVALID_PARAM` | `ApiError`       | 修正 `term`、`limit`、`filter` 后重试    |
| 无权访问目标房间或资料 | `403` / `M_FORBIDDEN`                  | `ApiError`       | 提示用户缺少对应房间成员资格或资料可见性 |
| 上下文房间/事件不存在  | `404` / `M_NOT_FOUND`                  | `NotFoundError`  | 提示目标房间或事件已不存在               |
| 限流或短暂服务异常     | `429` / `M_LIMIT_EXCEEDED`             | `RetryableError` | 使用退避重试                             |
| 其他 API 错误          | 其他 `4xx/5xx`                         | `ApiError`       | 按 `code` 与 `statusCode` 做兜底处理     |

## 典型 errcode

| errcode            | 常见 HTTP | 说明                           |
| ------------------ | --------- | ------------------------------ |
| `M_UNKNOWN_TOKEN`  | `401`     | access token 无效、过期或缺失  |
| `M_BAD_JSON`       | `400`     | 请求体结构不符合接口要求       |
| `M_INVALID_PARAM`  | `400`     | 搜索词、过滤器或分页参数非法   |
| `M_FORBIDDEN`      | `403`     | 无权搜索目标房间或查看受限资料 |
| `M_NOT_FOUND`      | `404`     | 请求中的房间或事件不存在       |
| `M_LIMIT_EXCEEDED` | `429`     | 搜索请求触发限流               |
