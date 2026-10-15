---
module: captcha
generated_from: docs/api-contract/generated/modules/captcha.json
generated_hash: sha256-ae66bfd1f239ebc34febe894afd101c1be24b1b444bcc8be31b0ae57afa61604
ledger_schema: 4
last_reviewed: 2026-10-14
---

# CAPTCHA API 契约文档

> 后端代码: `synapse-rust/synapse-web/src/routes/captcha.rs`
> 装配入口: `synapse-rust/synapse-web/src/routes/assembly.rs`

## 真实后端路由

> 2026-10-14 按 `docs/api-contract/generated/modules/captcha.json` 与
> `synapse-web/src/routes/captcha.rs` 的 `create_captcha_router` 订正：早先本表列了 3 条
> `r0` 路径（**`r0` 已退役**，后端并未注册），且**漏了** `DELETE .../captcha/clean`。

| 方法   | 路径                                         | 说明           | 认证   |
| ------ | -------------------------------------------- | -------------- | ------ |
| POST   | `/_matrix/client/v3/register/captcha/send`   | 发送验证码挑战 | 公开   |
| GET    | `/_matrix/client/v3/register/captcha/status` | 查询验证码状态 | 公开   |
| POST   | `/_matrix/client/v3/register/captcha/verify` | 验证验证码     | 公开   |
| DELETE | `/_matrix/client/v3/register/captcha/clean`  | 清理过期验证码 | 公开   |
| POST   | `/_synapse/admin/v1/captcha/cleanup`         | 清理过期验证码 | 管理员 |

## 结构化类型（codegen 源）

> 本节是 `scripts/sdk-contract-codegen.mjs` 的 DTO 提取源。形状逐条对照
> `synapse-web/src/routes/captcha.rs` 与 `synapse-services/src/captcha_service.rs`、
> `synapse-storage/src/captcha.rs` 的实现，**不凭印象**。
>
> ⚠️ 两个容易踩的点，已按实现固化在下面：
>
> 1. **`verify` 的响应字段是 `verified`**（不是 `is_verified`）——Rust 结构体字段叫 `is_verified`，
>    但有 `#[serde(rename = "verified")]`，**wire 上只有 `verified`**。
> 2. **`verify` 的请求体带 `#[serde(deny_unknown_fields)]`**，只接受 `{captcha_id, code}`；
>    多传任何字段（例如 `session`）会被 serde 直接拒绝。

```typescript
/** `POST .../register/captcha/send` 请求体（后端 `SendCaptchaBody` / `SendCaptchaRequest`）。 */
export interface SendCaptchaRequest {
    captcha_type: string;
    /** 验证码投递目标（手机号 / 邮箱）。**必填**。 */
    target: string;
    template_name?: string;
}

/** `POST .../register/captcha/send` 响应（后端 `CaptchaResponse`）。 */
export interface SendCaptchaResponse {
    captcha_id: string;
    /** 有效期，毫秒。 */
    expires_in: number;
    captcha_type: string;
}

/** `POST .../register/captcha/verify` 请求体（后端 `VerifyCaptchaBody`）。 */
export interface VerifyCaptchaRequest {
    captcha_id: string;
    code: string;
}

/** `POST .../register/captcha/verify` 响应（后端 `VerifyResponse`，字段名被 rename 成 `verified`）。 */
export interface VerifyCaptchaResponse {
    verified: boolean;
}

/** `GET .../register/captcha/status` 响应（后端 `get_captcha_status` 的 `json!`）。 */
export interface CaptchaStatusResponse {
    captcha_id: string;
    captcha_type: string;
    target: string;
    status: string;
    attempt_count: number;
    max_attempts: number;
    expires_at: number;
    created_at: number;
}

/** `DELETE .../register/captcha/clean` 与 `POST /_synapse/admin/v1/captcha/cleanup` 响应。 */
export interface CaptchaCleanupResponse {
    cleaned_count: number;
    message: string;
}
```

## SDK 对齐状态

| 端点                                      | SDK Manager      | 方法                              | 状态 |
| ----------------------------------------- | ---------------- | --------------------------------- | ---- |
| `POST /{r0,v3}/register/captcha/send`     | `CaptchaManager` | `sendCaptcha(..., version?)`      | ✅   |
| `GET /{r0,v3}/register/captcha/status`    | `CaptchaManager` | `getCaptchaStatus(..., version?)` | ✅   |
| `POST /{r0,v3}/register/captcha/verify`   | `CaptchaManager` | `verifyCaptcha(..., version?)`    | ✅   |
| `POST /_synapse/admin/v1/captcha/cleanup` | `CaptchaManager` | `cleanupExpiredCaptchas()`        | ✅   |

## 覆盖率口径

- **后端 Ledger 路由总数**: 5
- **SDK 已封装路由数**: 5
- **已绑定生成路由模板**: 5
- **契约覆盖率**: 100%
- **说明**:
    - `CaptchaManager` 默认选择 `v3` 作为 canonical 封装面。
    - **`r0` 已退役**：后端不再注册 `r0` 形态（早先本页记的 3 条 `r0` 是被删快照），SDK 亦不再暴露
      `version: "r0"` 分支。
    - 客户端 `captcha` 路由属于注册流程公开端点，应走 `request()` 而非 `authedRequest()`。

## 常见状态码

| 状态码 | 说明                       |
| ------ | -------------------------- |
| `200`  | 发送、查询或验证成功       |
| `400`  | 参数缺失或验证码格式不合法 |
| `401`  | 管理清理接口缺少管理员身份 |
| `404`  | 指定 `captcha_id` 不存在   |
| `429`  | 验证码请求或校验触发限流   |
