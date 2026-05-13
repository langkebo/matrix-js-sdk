---
module: captcha
generated_from: docs/api-contract/generated/modules/captcha.json
generated_hash: sha256-e02c5be968aba2cb6fb26fb557db2095fce6dfe68d5116c7afd857a6a7cd3914
ledger_schema: 1
last_reviewed: 2026-05-03
---

# CAPTCHA API 契约文档

> 后端代码: `synapse-rust/src/web/routes/captcha.rs`
> 装配入口: `synapse-rust/src/web/routes/assembly.rs`

## 真实后端路由

| 方法 | 路径 | 说明 | 认证 |
| ---- | ---- | ---- | ---- |
| POST | `/_matrix/client/r0/register/captcha/send` | r0 发送验证码挑战 | 公开 |
| GET | `/_matrix/client/r0/register/captcha/status` | r0 查询验证码状态 | 公开 |
| POST | `/_matrix/client/r0/register/captcha/verify` | r0 验证验证码 | 公开 |
| POST | `/_matrix/client/v3/register/captcha/send` | v3 发送验证码挑战 | 公开 |
| GET | `/_matrix/client/v3/register/captcha/status` | v3 查询验证码状态 | 公开 |
| POST | `/_matrix/client/v3/register/captcha/verify` | v3 验证验证码 | 公开 |
| POST | `/_synapse/admin/v1/captcha/cleanup` | 清理过期验证码 | 管理员 |

## SDK 对齐状态

| 端点 | SDK Manager | 方法 | 状态 |
| ---- | ----------- | ---- | ---- |
| `POST /v3/register/captcha/send` | `CaptchaManager` | `sendCaptcha()` | ✅ |
| `GET /v3/register/captcha/status` | `CaptchaManager` | `getCaptchaStatus()` | ✅ |
| `POST /v3/register/captcha/verify` | `CaptchaManager` | `verifyCaptcha()` | ✅ |
| `POST /_synapse/admin/v1/captcha/cleanup` | `CaptchaManager` | `cleanupExpiredCaptchas()` | ✅ |

## 覆盖率口径

- **后端 Ledger 路由总数**: 7
- **SDK 已封装路由数**: 4
- **已绑定生成路由模板**: 4
- **契约覆盖率**: 100%
- **说明**:
    - `CaptchaManager` 选择 `v3` 作为 canonical 封装面。
    - 后端保留的 3 条 `r0` 路径与 `v3` 逻辑一致，SDK 不再额外暴露重复方法，视为逻辑覆盖 100%。
    - 客户端 `captcha` 路由属于注册流程公开端点，应走 `request()` 而非 `authedRequest()`。

## 常见状态码

| 状态码 | 说明 |
| ------ | ---- |
| `200` | 发送、查询或验证成功 |
| `400` | 参数缺失或验证码格式不合法 |
| `401` | 管理清理接口缺少管理员身份 |
| `404` | 指定 `captcha_id` 不存在 |
| `429` | 验证码请求或校验触发限流 |
