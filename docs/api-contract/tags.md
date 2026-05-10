---
module: tags
generated_from: docs/api-contract/generated/modules/tags.json
generated_hash: sha256-6beabeb1588011a108da7a49c37b0bf2d880dc6b0b4fe8482553e5d8db72a93f
ledger_schema: 1
last_reviewed: 2026-05-03
---

# 标签契约

> 审查来源: `synapse-rust/src/web/routes/room.rs` (tags section)

## 真实后端路由

| 方法   | 路径                                            | 说明         | 认证 |
| ------ | ----------------------------------------------- | ------------ | ---- |
| GET    | `/_matrix/client/r0/rooms/{room_id}/tags`       | 获取房间标签 | 用户 |
| PUT    | `/_matrix/client/r0/rooms/{room_id}/tags/{tag}` | 设置房间标签 | 用户 |
| DELETE | `/_matrix/client/r0/rooms/{room_id}/tags/{tag}` | 删除房间标签 | 用户 |
| GET    | `/_matrix/client/v3/rooms/{room_id}/tags`       | 获取房间标签 | 用户 |
| PUT    | `/_matrix/client/v3/rooms/{room_id}/tags/{tag}` | 设置房间标签 | 用户 |
| DELETE | `/_matrix/client/v3/rooms/{room_id}/tags/{tag}` | 删除房间标签 | 用户 |

## SDK 对齐状态

| 端点                 | SDK Manager    | 方法              | 状态      |
| -------------------- | -------------- | ----------------- | --------- |
| `GET /tags`          | `MatrixClient` | `getRoomTags()`   | ✅ 已封装 |
| `PUT /tags/{tag}`    | `MatrixClient` | `setRoomTag()`    | ✅ 已封装 |
| `DELETE /tags/{tag}` | `MatrixClient` | `deleteRoomTag()` | ✅ 已封装 |

## 常见状态码

| 状态码 | 说明                             |
| ------ | -------------------------------- |
| `200`  | 请求成功                         |
| `400`  | 标签名、排序值或请求体格式非法   |
| `401`  | Token 无效或缺失                 |
| `403`  | 非房间成员或无权修改目标房间标签 |
| `404`  | 房间或标签不存在                 |
| `429`  | 触发限流                         |

## 错误语义对齐（BaseManager）

| 场景                | HTTP / errcode                         | SDK 统一错误类型 | 调用方建议                           |
| ------------------- | -------------------------------------- | ---------------- | ------------------------------------ |
| 未认证或 token 失效 | `401` / `M_UNKNOWN_TOKEN`              | `AuthError`      | 引导重新登录                         |
| 标签参数不合法      | `400` / `M_BAD_JSON` `M_INVALID_PARAM` | `ApiError`       | 修正标签名、`order` 或请求体后重试   |
| 权限不足            | `403` / `M_FORBIDDEN`                  | `ApiError`       | 提示用户需要对应房间访问权限         |
| 房间或标签不存在    | `404` / `M_NOT_FOUND`                  | `NotFoundError`  | 刷新本地标签状态后再决定是否重试     |
| 限流或短暂服务异常  | `429` / `M_LIMIT_EXCEEDED`             | `RetryableError` | 使用退避重试                         |
| 其他 API 错误       | 其他 `4xx/5xx`                         | `ApiError`       | 按 `code` 与 `statusCode` 做兜底处理 |

## 典型 errcode

| errcode            | 常见 HTTP | 说明                          |
| ------------------ | --------- | ----------------------------- |
| `M_UNKNOWN_TOKEN`  | `401`     | access token 无效、过期或缺失 |
| `M_BAD_JSON`       | `400`     | 标签请求体结构不符合接口要求  |
| `M_INVALID_PARAM`  | `400`     | 标签名或 `order` 参数非法     |
| `M_FORBIDDEN`      | `403`     | 无权读取或写入该房间标签      |
| `M_NOT_FOUND`      | `404`     | 房间或指定标签不存在          |
| `M_LIMIT_EXCEEDED` | `429`     | 标签相关请求触发限流          |
