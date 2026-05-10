---
module: openclaw
generated_from: docs/api-contract/generated/modules/openclaw.json
generated_hash: sha256-9bfa0c05b2083c1dadde4f6b8c3dad81a83e5355f79840de79e237e02ff54181
ledger_schema: 1
last_reviewed: 2026-05-03
---

# OpenClaw 契约

> 审查来源: `synapse-rust/src/web/routes/openclaw.rs`

## 真实后端路由

| 方法 | 路径                                 | 说明               | 认证 |
| ---- | ------------------------------------ | ------------------ | ---- |
| GET  | `/_matrix/client/v1/openclaw/config` | 获取 OpenClaw 配置 | 用户 |
| POST | `/_matrix/client/v1/openclaw/action` | 执行 OpenClaw 动作 | 用户 |

## SDK 对齐状态

| 端点                    | SDK Manager       | 方法              | 状态      |
| ----------------------- | ----------------- | ----------------- | --------- |
| `GET /openclaw/config`  | `OpenClawManager` | `getConfig()`     | ✅ 已封装 |
| `POST /openclaw/action` | `OpenClawManager` | `executeAction()` | ✅ 已封装 |

## 常见状态码

| 状态码 | 说明                              |
| ------ | --------------------------------- |
| `200`  | 请求成功                          |
| `400`  | OpenClaw 动作参数或请求体格式非法 |
| `401`  | Token 无效或缺失                  |
| `403`  | 当前账号无权执行 OpenClaw 动作    |
| `404`  | OpenClaw 配置或目标动作资源不存在 |

## 错误语义对齐（BaseManager）

| 场景                    | HTTP / errcode                         | SDK 统一错误类型 | 调用方建议                           |
| ----------------------- | -------------------------------------- | ---------------- | ------------------------------------ |
| 未认证或 token 失效     | `401` / `M_UNKNOWN_TOKEN`              | `AuthError`      | 引导重新登录                         |
| OpenClaw 请求参数不合法 | `400` / `M_BAD_JSON` `M_INVALID_PARAM` | `ApiError`       | 修正动作类型、payload 或请求体后重试 |
| 权限不足                | `403` / `M_FORBIDDEN`                  | `ApiError`       | 提示用户当前账号无权执行该动作       |
| 配置或目标资源不存在    | `404` / `M_NOT_FOUND`                  | `NotFoundError`  | 刷新配置并核对目标资源状态           |

## 典型 errcode

| errcode           | 常见 HTTP | 说明                             |
| ----------------- | --------- | -------------------------------- |
| `M_UNKNOWN_TOKEN` | `401`     | access token 无效、过期或缺失    |
| `M_BAD_JSON`      | `400`     | OpenClaw 请求体结构不合法        |
| `M_INVALID_PARAM` | `400`     | 动作参数、payload 或查询字段非法 |
| `M_FORBIDDEN`     | `403`     | 无权读取配置或执行目标动作       |
| `M_NOT_FOUND`     | `404`     | OpenClaw 配置或目标资源不存在    |
