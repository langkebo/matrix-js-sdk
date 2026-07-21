---
module: verification_routes
generated_from: docs/api-contract/generated/modules/verification_routes.json
generated_hash: sha256-8d63310570a3f6686f0802e6d02931afcfe3a56d27948ff0202b710c527785f2
ledger_schema: 1
last_reviewed: 2026-06-01
---

# Verification 契约

> **审计状态**: ✅ `VerificationManager` 全部 9 条兼容端点已绑定生成 `VerificationPathPattern`，默认保持 v1，支持调用方显式选择 r0/v3，并补齐专用路径单测
>
> 审查来源: `synapse-rust/src/web/routes/verification_routes.rs`
>
> 本文覆盖设备交叉签名验证与二维码校验的兼容路由。它们与 `e2ee.md` 中的 v3 `device_verification/*` 属于两套不同接口族，不能混写。

## 挂载版本

| 前缀                 | 说明                           |
| -------------------- | ------------------------------ |
| `/_matrix/client/v1` | 支持全部 verification 兼容路由 |
| `/_matrix/client/r0` | 支持全部 verification 兼容路由 |
| `/_matrix/client/v3` | 支持全部 verification 兼容路由 |

## 认证与通用约定

- 本文件所有端点都要求用户 access token。
- `show_qr_code` 与 `scan_qr_code` 额外要求认证上下文带有 `device_id`，否则返回 `400`。
- 常见错误码: `400` 参数缺失/格式错误、`401` 未认证、`404` 验证事务不存在、`500` 验证服务异常。
- 所有响应都由 handler 显式组装，不依赖隐式序列化。

## SAS 设备校验流程

| 方法 | 路径                                                                  | 版本     | 主要请求参数                                                     | 主要响应字段                                                                                         |
| ---- | --------------------------------------------------------------------- | -------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| POST | `/_matrix/client/{v1,r0,v3}/keys/device_signing/verify_start`         | v1/r0/v3 | `from_device` `to_user` `to_device?` `transaction_id?` `method?` | `transaction_id` `method` `key_agreement_protocol` `hash` `short_authentication_string`              |
| PUT  | `/_matrix/client/{v1,r0,v3}/keys/device_signing/verify_accept`        | v1/r0/v3 | `transaction_id` `key_agreement_protocol` `hash` `commitment?`   | `transaction_id` `method` `key_agreement_protocol` `hash` `short_authentication_string` `commitment` |
| POST | `/_matrix/client/{v1,r0,v3}/keys/device_signing/verify_key_agreement` | v1/r0/v3 | `transaction_id` `pubkey`                                        | `transaction_id` `confirmed` `short_authentication_string`                                           |
| POST | `/_matrix/client/{v1,r0,v3}/keys/device_signing/verify_mac`           | v1/r0/v3 | `transaction_id` `mac`                                           | `transaction_id` `verified`                                                                          |
| POST | `/_matrix/client/{v1,r0,v3}/keys/device_signing/verify_done`          | v1/r0/v3 | `transaction_id`                                                 | `transaction_id`                                                                                     |
| POST | `/_matrix/client/{v1,r0,v3}/keys/device_signing/verify_cancel`        | v1/r0/v3 | `transaction_id` `reason?`                                       | `transaction_id` `cancelled`                                                                         |
| GET  | `/_matrix/client/{v1,r0,v3}/keys/device_signing/requests`             | v1/r0/v3 | 无                                                               | `requests`                                                                                           |

## 二维码校验

| 方法 | 路径                                           | 版本     | 主要请求参数                                                                                      | 主要响应字段                                                                                      |
| ---- | ---------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| GET  | `/_matrix/client/{v1,r0,v3}/keys/qr_code/show` | v1/r0/v3 | 无                                                                                                | `transaction_id` `server_name` `user_id` `device_id` `device_ed25519_key` `device_curve25519_key` |
| POST | `/_matrix/client/{v1,r0,v3}/keys/qr_code/scan` | v1/r0/v3 | `transaction_id` `server_name` `user_id` `device_id` `device_ed25519_key` `device_curve25519_key` | `transaction_id` `state`                                                                          |

## 典型请求/响应

- `POST /keys/device_signing/verify_start`: 由当前登录设备向目标用户/设备发起 SAS 验证；返回协商方式列表和短字符串表示能力。
- `PUT /keys/device_signing/verify_accept`: 接受 SAS 验证后，返回同一事务的协商结果和可选 `commitment`。
- `POST /keys/device_signing/verify_key_agreement`: 用对端公钥生成 SAS 展示内容；若底层生成的是 emoji，响应里还会附带三段 decimal points。
- `POST /keys/device_signing/verify_mac`: 用 MAC 确认 SAS；成功返回 `{ "transaction_id": "...", "verified": true|false }`。
- `POST /keys/device_signing/verify_cancel`: 取消已存在的验证事务；成功返回 `{ "transaction_id": "...", "cancelled": true }`。
- `GET /keys/device_signing/requests`: 列出当前用户可见的验证请求摘要。
- `GET /keys/qr_code/show`: 返回用于展示二维码的设备公钥材料，不直接返回图片。
- `POST /keys/qr_code/scan`: 当前成功响应固定返回 `{ "transaction_id": "...", "state": "pending" }`。

## 行为备注

- `verify_start` 请求体里的 `transaction_id`、`method` 当前不会直接驱动 handler 分支；真正使用的是认证用户、目标用户和目标设备。
- `verify_accept` 请求体中的 `commitment` 当前只作为入参结构保留，handler 实际调用只使用 `transaction_id`、`key_agreement_protocol`、`hash`。
- `verify_done` 当前内部通过 `confirm_sas(transaction_id, "")` 标记完成，没有单独的 done service 方法。
- `verify_key_agreement` 返回的 `short_authentication_string` 形态不固定:
    - emoji 模式下会包含 `emoji`，并附带 `decimal.points`
    - decimal 模式下只包含 `decimal.points`
- `scan_qr_code` 当前构造的 `QrCodeData` 中 `server_public_key` 与 `signature` 被置为空字符串，不在响应中回传。

## 代码定位

- 路由定义: `synapse-rust/src/web/routes/verification_routes.rs`
- 验证服务: `synapse-rust/src/e2ee/verification/service.rs`

## SDK 对齐状态

`matrix-js-sdk/src/verification/index.ts` 的 `VerificationManager` 封装全部 9 条端点，
由 `extendMatrixClient()` 注册 `MatrixClient.getVerificationManager()`；同时登记在
`matrix-client-extensions.d.ts` 与 `manager-extensions/index.ts` 的默认扩展列表。

| 端点                                                | SDK 方法                     |
| --------------------------------------------------- | ---------------------------- |
| `POST .../keys/device_signing/verify_start`         | `startVerification()`        |
| `PUT  .../keys/device_signing/verify_accept`        | `acceptVerification()`       |
| `POST .../keys/device_signing/verify_key_agreement` | `exchangeKeys()`             |
| `POST .../keys/device_signing/verify_mac`           | `confirmMac()`               |
| `POST .../keys/device_signing/verify_done`          | `completeVerification()`     |
| `POST .../keys/device_signing/verify_cancel`        | `cancelVerification()`       |
| `GET  .../keys/device_signing/requests`             | `listPendingVerifications()` |
| `GET  .../keys/qr_code/show`                        | `showQrCode()`               |
| `POST .../keys/qr_code/scan`                        | `scanQrCode()`               |

> SDK 默认用 `ClientPrefix.V1` 保持兼容；调用方可在 `VerificationManager` 方法上传入 `"r0"` 或 `"v3"`，显式绑定生成契约中的对应前缀。`device_verification/*` 仍归 `e2ee_routes`。

## SDK 对齐结论

- `src/verification/index.ts` 现已将 `verify_start`、`verify_accept`、`verify_key_agreement`、`verify_mac`、`verify_done`、`verify_cancel`、`requests`、`qr_code/show`、`qr_code/scan` 全部绑定到生成的 `VerificationPathPattern`。
- `VerificationManager` 继续默认走 `ClientPrefix.V1` 主路径；`r0` 与 `v3` 兼容前缀由同一份后端 handler 承接，不再视为人工封装缺口。
- `spec/unit/verification-manager.spec.ts` 新增专用断言，覆盖主 HTTP 路径、参数校验和 `listPendingVerifications()` 的失败回退分支。

## 覆盖率口径

- **Ledger 契约端点数**: 36
- **SDK 主路径覆盖**: 36/36
- **已绑定生成路由模板**: 36/36
- **契约覆盖率**: 100%

## DTO Definitions

> Source: `src/verification/__generated__/dto.ts`

```typescript
export interface VerificationStartRequest {
    from_device: string;
    to_user: string;
    to_device?: string;
    transaction_id?: string;
    method?: string;
}
export interface VerificationStartResponse {
    transaction_id: string;
    method: string;
    key_agreement_protocol: string[];
    hash: string[];
    short_authentication_string: string[];
}
export interface VerificationAcceptRequest {
    transaction_id: string;
    key_agreement_protocol: string;
    hash: string;
    commitment?: string;
}
export interface VerificationAcceptResponse extends VerificationStartResponse {
    commitment?: string;
}
export interface VerificationKeyAgreementRequest {
    transaction_id: string;
    pubkey: string;
}
export interface VerificationKeyAgreementResponse {
    transaction_id: string;
    confirmed: boolean;
    short_authentication_string: { emoji?: string[]; decimal?: { points: number[] } };
}
export interface VerificationMacRequest {
    transaction_id: string;
    mac: string;
}
export interface VerificationMacResponse {
    transaction_id: string;
    verified: boolean;
}
export interface VerificationDoneRequest {
    transaction_id: string;
    mac: string;
}
export interface VerificationDoneResponse {
    transaction_id: string;
}
export interface VerificationCancelRequest {
    transaction_id: string;
    code: string;
    reason: string;
}
export interface VerificationCancelResponse {
    transaction_id: string;
    state: "cancelled";
    code: string;
    reason: string;
}
export interface VerificationRequestEntry {
    transaction_id: string;
    from_user: string;
    from_device: string;
    to_user: string;
    to_device?: string;
    method: string;
    state: string;
    created_ts: number;
    updated_ts: number;
}
export interface ListVerificationRequestsResponse {
    requests: VerificationRequestEntry[];
}
export interface QrCodeShowResponse {
    transaction_id: string;
    server_name: string;
    user_id: string;
    device_id: string;
    device_ed25519_key: string;
    device_curve25519_key: string;
}
export interface ScanQrCodeRequest {
    transaction_id: string;
    server_name: string;
    user_id: string;
    device_id: string;
    device_ed25519_key: string;
    device_curve25519_key: string;
}
export interface ScanQrCodeResponse {
    transaction_id: string;
    state: "pending" | "verified" | "cancelled";
}
```
