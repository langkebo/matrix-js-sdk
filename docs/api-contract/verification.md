# Verification 契约

> 审查来源: `synapse-rust/src/web/routes/verification_routes.rs`
>
> 本文覆盖设备交叉签名验证与二维码校验的兼容路由。它们与 `e2ee.md` 中的 v3 `device_verification/*` 属于两套不同接口族，不能混写。

## 挂载版本

| 前缀 | 说明 |
|------|------|
| `/_matrix/client/v1` | 支持全部 verification 兼容路由 |
| `/_matrix/client/r0` | 支持全部 verification 兼容路由 |

> 当前 `verification_routes.rs` 没有挂到 `/_matrix/client/v3`。

## 认证与通用约定

- 本文件所有端点都要求用户 access token。
- `show_qr_code` 与 `scan_qr_code` 额外要求认证上下文带有 `device_id`，否则返回 `400`。
- 常见错误码: `400` 参数缺失/格式错误、`401` 未认证、`404` 验证事务不存在、`500` 验证服务异常。
- 所有响应都由 handler 显式组装，不依赖隐式序列化。

## SAS 设备校验流程

| 方法 | 路径 | 版本 | 主要请求参数 | 主要响应字段 |
|------|------|------|--------------|--------------|
| POST | `/_matrix/client/{v1,r0}/keys/device_signing/verify_start` | v1/r0 | `from_device` `to_user` `to_device?` `transaction_id?` `method?` | `transaction_id` `method` `key_agreement_protocol` `hash` `short_authentication_string` |
| PUT | `/_matrix/client/{v1,r0}/keys/device_signing/verify_accept` | v1/r0 | `transaction_id` `key_agreement_protocol` `hash` `commitment?` | `transaction_id` `method` `key_agreement_protocol` `hash` `short_authentication_string` `commitment` |
| POST | `/_matrix/client/{v1,r0}/keys/device_signing/verify_key_agreement` | v1/r0 | `transaction_id` `pubkey` | `transaction_id` `confirmed` `short_authentication_string` |
| POST | `/_matrix/client/{v1,r0}/keys/device_signing/verify_mac` | v1/r0 | `transaction_id` `mac` | `transaction_id` `verified` |
| POST | `/_matrix/client/{v1,r0}/keys/device_signing/verify_done` | v1/r0 | `transaction_id` | `transaction_id` |

## 二维码校验

| 方法 | 路径 | 版本 | 主要请求参数 | 主要响应字段 |
|------|------|------|--------------|--------------|
| GET | `/_matrix/client/{v1,r0}/keys/qr_code/show` | v1/r0 | 无 | `transaction_id` `server_name` `user_id` `device_id` `device_ed25519_key` `device_curve25519_key` |
| POST | `/_matrix/client/{v1,r0}/keys/qr_code/scan` | v1/r0 | `transaction_id` `server_name` `user_id` `device_id` `device_ed25519_key` `device_curve25519_key` | `transaction_id` `state` |

## 典型请求/响应

- `POST /keys/device_signing/verify_start`: 由当前登录设备向目标用户/设备发起 SAS 验证；返回协商方式列表和短字符串表示能力。
- `PUT /keys/device_signing/verify_accept`: 接受 SAS 验证后，返回同一事务的协商结果和可选 `commitment`。
- `POST /keys/device_signing/verify_key_agreement`: 用对端公钥生成 SAS 展示内容；若底层生成的是 emoji，响应里还会附带三段 decimal points。
- `POST /keys/device_signing/verify_mac`: 用 MAC 确认 SAS；成功返回 `{ "transaction_id": "...", "verified": true|false }`。
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
