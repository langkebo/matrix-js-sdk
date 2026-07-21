---
module: sliding_sync
generated_from: docs/api-contract/generated/modules/sliding_sync.json
generated_hash: sha256-a4daa2b735c9490ac7af2fd35d32d3df1f8ad4abcbc4c230e843fc4e5ec52863
ledger_schema: 1
last_reviewed: 2026-05-03
---

# Sliding Sync 契约

> 审查来源: `synapse-rust/src/web/routes/sliding_sync.rs`
> 审计状态: ✅ `MatrixClient.slidingSync()` 已绑定生成 `SlidingSyncPathPattern`

## 真实后端路由

| 方法 | 路径                              | 说明         | 认证 |
| ---- | --------------------------------- | ------------ | ---- |
| POST | `/_matrix/client/v3/sync/sliding` | Sliding Sync | 用户 |

## SDK 对齐状态

| 端点                 | SDK Manager      | 方法     | 状态      |
| -------------------- | ---------------- | -------- | --------- |
| `POST /sync/sliding` | `SlidingSyncSdk` | `sync()` | ✅ 已封装 |

## 本轮收口

- `src/client.ts` 中的 `MatrixClient.slidingSync()` 现已将 `"/sync"` 绑定到生成的 `SlidingSyncPathPattern`。
- SDK 继续默认走 `/_matrix/client/unstable/org.matrix.simplified_msc3575/sync` 前缀，并保留 `pos` / `timeout` 走查询参数、`clientTimeout` 只映射到 `localTimeoutMs` 的现有语义。
- 当前契约主入口与单测断言已对齐，不再依赖裸字符串路径。

## 常见状态码

| 状态码 | 说明                            |
| ------ | ------------------------------- |
| `200`  | 请求成功                        |
| `400`  | `pos`、列表窗口或请求体格式非法 |
| `401`  | Token 无效或缺失                |
| `429`  | Sliding Sync 长轮询触发限流     |

## 错误语义对齐（BaseManager）

| 场景                    | HTTP / errcode                         | SDK 统一错误类型 | 调用方建议                                                  |
| ----------------------- | -------------------------------------- | ---------------- | ----------------------------------------------------------- |
| 未认证或 token 失效     | `401` / `M_UNKNOWN_TOKEN`              | `AuthError`      | 引导重新登录                                                |
| Sliding Sync 参数不合法 | `400` / `M_BAD_JSON` `M_INVALID_PARAM` | `ApiError`       | 修正 `pos`、list ranges、subscriptions 或 extensions 后重试 |
| 长轮询限流或暂时拥塞    | `429` / `M_LIMIT_EXCEEDED`             | `RetryableError` | 使用退避重试并保留上一次 `pos`                              |

## 典型 errcode

| errcode            | 常见 HTTP | 说明                                |
| ------------------ | --------- | ----------------------------------- |
| `M_UNKNOWN_TOKEN`  | `401`     | access token 无效、过期或缺失       |
| `M_BAD_JSON`       | `400`     | Sliding Sync 请求体结构不合法       |
| `M_INVALID_PARAM`  | `400`     | `pos`、列表窗口、订阅或扩展参数非法 |
| `M_LIMIT_EXCEEDED` | `429`     | Sliding Sync 长轮询触发限流         |
