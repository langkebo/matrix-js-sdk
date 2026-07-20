---
module: e2ee
generated_from: docs/api-contract/generated/modules/e2ee.json
generated_hash: sha256-23a9582548e53a23137ea66fa30a3ab161c43553dd513d3c230855547fb8b4e9
ledger_schema: 1
last_reviewed: 2026-05-11
---

# E2EE API 契约

> 审查来源: `synapse-rust/src/web/routes/e2ee_routes.rs`
> 对应 SDK 模块: `src/device-keys/index.ts`, `src/device-trust/index.ts`, `src/secure-backup/index.ts`, `src/e2ee/index.ts`

## 本次复核结论

- 后端实际分为两层路由:
    - compat 路由同时挂在 `/_matrix/client/r0`、`/_matrix/client/v1`、`/_matrix/client/v3`
    - v3-only 路由只挂在 `/_matrix/client/v3`
- SDK 并不是单一 `E2EEManager` 封装，而是四层入口并存:
    - `DeviceKeysManager`: 设备密钥、签名、room key request、to-device
    - `DeviceTrustManager`: 设备验证、设备信任、安全摘要
    - `SecureBackupManager`: secure backup 的高层类型化封装
    - `E2EEManager`: 面向后端原始端点的低层薄封装
- `DeviceTrustManager` 与后端 `device_verification/*` 的请求体最贴近；`DeviceKeysManager` 的兼容验证 helper 现已补齐后端兼容字段，但新接入仍建议优先走 `DeviceTrustManager`。
- `GET /rooms/{room_id}/keys/distribution` 当前后端直接返回 `403 Forbidden`，属于服务端内部接口，不是可正常消费的客户端业务 API。
- secure backup 后端返回字段比 SDK 高层类型更丰富，文档以下文“稳定字段 + SDK 实际消费字段”的方式说明。
- `E2EEManager` 现已绑定生成的 `E2eePathPattern`，并补齐 `requestDeviceVerification()` / `createSecureBackup()` 的后端真实参数语义。

## 路由挂载

| 前缀                 | 真实后端暴露                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `/_matrix/client/r0` | compat: `keys/*`、`room_keys/request*`、`sendToDevice`、`rooms/{room_id}/keys/distribution`       |
| `/_matrix/client/v1` | 同 r0                                                                                             |
| `/_matrix/client/v3` | compat 全量 + `device_verification/*`、`device_trust*`、`security/summary`、`keys/backup/secure*` |

## SDK 入口分层

| SDK 入口              | 主要职责                                                         | 说明                                                                              |
| --------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `DeviceKeysManager`   | 密钥上传/查询/claim、设备列表、签名、room key request、to-device | 高层类型较多，但部分返回结构落后于后端                                            |
| `DeviceTrustManager`  | 验证请求、验证响应、设备信任、安全摘要                           | 与后端 `approved` / `token` 语义一致                                              |
| `SecureBackupManager` | secure backup 创建、查询、删除、写入、恢复、校验                 | 高层类型化接口，屏蔽部分后端扩展字段                                              |
| `E2EEManager`         | 全量原始端点薄封装                                               | `Record<string, unknown>` 风格，现已绑定 `E2eePathPattern`，适合契约测试/迁移脚本 |

## 真实端点与封装状态

### Compat 路由

| 方法     | 路径                                          | 后端行为                                                                                      | SDK 主入口                                                                                                 |
| -------- | --------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `POST`   | `/keys/upload`                                | 上传设备密钥 / OTK / fallback key                                                             | `DeviceKeysManager.uploadKeys()` / `E2EEManager.uploadKeys()`                                              |
| `POST`   | `/keys/upload/{device_id}`                    | 与 `/keys/upload` 共用 handler                                                                | SDK 无专门方法，需低层自拼路径                                                                             |
| `POST`   | `/keys/query`                                 | 返回 `device_keys`，并可能额外携带 `master_keys` / `self_signing_keys` / `user_signing_keys`  | `DeviceKeysManager.queryKeys()` / `E2EEManager.queryKeys()`                                                |
| `POST`   | `/keys/claim`                                 | claim OTK                                                                                     | `DeviceKeysManager.claimKeys()` / `E2EEManager.claimKeys()`                                                |
| `GET`    | `/keys/changes`                               | 返回 `changed[]` / `left[]`                                                                   | `DeviceKeysManager.getKeyChanges()` / `E2EEManager.getKeyChanges()`                                        |
| `POST`   | `/keys/device_list/update`                    | 初始全量时 `changed` 为设备对象数组；增量时可能含 `deleted[]` 与 `stream_id`                  | `DeviceKeysManager.updateDeviceList()` / `E2EEManager.postDeviceListUpdate()`                              |
| `POST`   | `/keys/signatures`                            | 上传签名                                                                                      | `DeviceKeysManager.uploadSignatures()` / `E2EEManager.uploadSignatures()`                                  |
| `POST`   | `/keys/signatures/upload`                     | `/keys/signatures` 兼容别名                                                                   | `E2EEManager.uploadSignaturesAlt()`                                                                        |
| `POST`   | `/keys/device_signing/upload`                 | 上传 master/self/user signing keys                                                            | `DeviceKeysManager.uploadDeviceSigning()` / `E2EEManager.uploadDeviceSigning()`                            |
| `POST`   | `/room_keys/request`                          | 创建请求，返回 `request_id`                                                                   | `DeviceKeysManager.createRoomKeyRequest()` / `E2EEManager.createRoomKeyRequest()`                          |
| `GET`    | `/room_keys/request`                          | 返回 `requests[]`，字段含 `action`、`request_type`、`status`、`created_ts`、`is_fulfilled` 等 | `DeviceKeysManager.getRoomKeyRequests()` / `E2EEManager.listRoomKeyRequests()`                             |
| `DELETE` | `/room_keys/request/{request_id}`             | 删除 / 取消请求                                                                               | `DeviceKeysManager.deleteRoomKeyRequest()` / `E2EEManager.deleteRoomKeyRequest()`                          |
| `GET`    | `/rooms/{room_id}/keys/distribution`          | 当前直接返回 `403 Forbidden`                                                                  | `DeviceKeysManager.getRoomKeyDistribution()` / `E2EEManager.getRoomKeyDistribution()` 仍保留，但调用将报错 |
| `PUT`    | `/sendToDevice/{event_type}/{transaction_id}` | 成功返回空 JSON                                                                               | `DeviceKeysManager.sendToDevice()` / `E2EEManager.sendToDevice()`                                          |

### V3-only 路由

| 方法     | 路径                                      | 后端行为                                                  | SDK 主入口                                                                                 |
| -------- | ----------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `POST`   | `/device_verification/request`            | 读取 `new_device_id` 或 `device_id`，`method` 默认 `sas`  | `DeviceTrustManager.requestVerification()` / `E2EEManager.requestDeviceVerification()`     |
| `POST`   | `/device_verification/respond`            | 读取 `request_token` 或 `token`，以及 `approved: boolean` | `DeviceTrustManager.respondToVerification()` / `E2EEManager.respondDeviceVerification()`   |
| `GET`    | `/device_verification/status/{token}`     | 找不到时返回 `200 { "status": "not_found" }`，不是 404    | `DeviceTrustManager.getVerificationStatus()` / `E2EEManager.getDeviceVerificationStatus()` |
| `GET`    | `/device_trust`                           | 返回 `{ devices: [...] }`                                 | `DeviceTrustManager.getDeviceTrustList()` / `E2EEManager.getDeviceTrustList()`             |
| `GET`    | `/device_trust/{device_id}`               | 未找到返回 `404 M_NOT_FOUND`                              | `DeviceTrustManager.getDeviceTrust()` / `E2EEManager.getDeviceTrust()`                     |
| `GET`    | `/security/summary`                       | 返回安全摘要                                              | `DeviceTrustManager.getSecuritySummary()` / `E2EEManager.getSecuritySummary()`             |
| `POST`   | `/keys/backup/secure`                     | 仅强制要求 `passphrase`                                   | `SecureBackupManager.createSecureBackup()` / `E2EEManager.createSecureBackup()`            |
| `GET`    | `/keys/backup/secure/{backup_id}`         | 返回 backup info                                          | `SecureBackupManager.getSecureBackup()` / `E2EEManager.getSecureBackup()`                  |
| `DELETE` | `/keys/backup/secure/{backup_id}`         | 删除备份                                                  | `SecureBackupManager.deleteSecureBackup()` / `E2EEManager.deleteSecureBackup()`            |
| `POST`   | `/keys/backup/secure/{backup_id}/keys`    | 返回 `{ count, key_count }`                               | `SecureBackupManager.addKeysToSecureBackup()` / `E2EEManager.storeSecureBackupKeys()`      |
| `POST`   | `/keys/backup/secure/{backup_id}/restore` | 返回 `{ success, restored_keys, key_count, message? }`    | `SecureBackupManager.restoreFromSecureBackup()` / `E2EEManager.restoreSecureBackup()`      |
| `POST`   | `/keys/backup/secure/{backup_id}/verify`  | 返回 `{ valid }`                                          | `SecureBackupManager.verifySecureBackup()` / `E2EEManager.verifySecureBackupPassphrase()`  |

## 参数与返回值对齐说明

### 设备密钥与设备列表

- `uploadKeys()`:
    - SDK 高层参数名为 `deviceKeys` / `oneTimeKeys` / `fallbackKeys`
    - 发送到后端时分别映射为 `device_keys` / `one_time_keys` / `fallback_keys`
- `queryKeys()`:
    - `DeviceKeysManager.QueryKeysResponse` 只稳定声明 `device_keys` 与 `failures`
    - 后端实际还会返回 `master_keys`、`self_signing_keys`、`user_signing_keys`
- `updateDeviceList()`:
    - 后端 `changed` 实际是设备对象数组，不是 `string[]`
    - 增量响应还可能出现 `deleted[]` 与 `stream_id`
    - `DeviceKeysManager.updateDeviceList()` 现已扩展为返回 `changed[]` 设备对象、`deleted[]`、`left[]`、`stream_id`

### 设备验证与设备信任

- `requestVerification()`:
    - 后端实际识别 `new_device_id` 或 `device_id`
    - `DeviceTrustManager.requestVerification()` 与后端匹配
    - `E2EEManager.requestDeviceVerification()` 现已改为只要求 `device_id | new_device_id`
    - `DeviceKeysManager.requestDeviceVerification()` 仍保留旧签名 `(targetUserId, targetDeviceId)`，但现在会同时发送 `device_id` / `new_device_id` 以兼容后端当前 handler；推荐新接入仍优先使用 `DeviceTrustManager`
- `respondToVerification()`:
    - 后端识别 `{ token | request_token, approved }`
    - `DeviceTrustManager.respondToVerification(token, approved)` 完全匹配
    - `DeviceKeysManager.respondDeviceVerification()` 现已将旧的 `"accept" | "reject"` 或布尔值转换为 `{ token, request_token, approved }`
- `getVerificationStatus()`:
    - 后端不存在时返回 `{ status: "not_found" }`
    - 因此 SDK 调用方不能把“未找到”仅理解为 404
- `getSecuritySummary()`:
    - `DeviceTrustManager.getSecuritySummary()` 出错时抛异常
    - `E2EEManager.getSecuritySummary()` 出错时记录 `logger.warn` 并返回 `{}` fallback

### Secure Backup

- `createSecureBackup()`:
    - `SecureBackupManager` 只暴露 `passphrase`
    - `E2EEManager.createSecureBackup()` 允许原始 body，包括 `algorithm` / `auth_data`
    - `E2EEManager.createSecureBackup()` 现已改为与后端一致，只强制 `passphrase`
    - 后端当前真正强制校验的只有 `passphrase`
- `addKeysToSecureBackup()`:
    - SDK 高层发送 `{ passphrase, session_keys }`
    - 单个 session 只稳定声明 `room_id` / `session_id` / `session_key`
    - 后端还兼容 `session_data.session_key`，并给 `first_message_index` / `forwarded_count` / `is_verified` 默认值
- `restoreFromSecureBackup()`:
    - SDK 高层类型只声明 `success` / `key_count` / `message?`
    - 后端额外返回 `restored_keys`，与 `key_count` 含义一致
- `addKeysToSecureBackup()` 返回:
    - SDK 高层类型只读取 `key_count`
    - 后端同时返回 `count`

## 错误语义

| 场景                   | 后端典型返回                                  | SDK 语义                                                        |
| ---------------------- | --------------------------------------------- | --------------------------------------------------------------- |
| 未认证 / token 无效    | `401` + `M_MISSING_TOKEN` / `M_UNKNOWN_TOKEN` | manager 统一归一化为鉴权错误                                    |
| 设备不存在             | `404` + `M_NOT_FOUND`                         | `DeviceTrustManager.getDeviceTrust()` 在高层接口中会返回 `null` |
| 验证 token 不存在      | `200 { "status": "not_found" }`               | 不触发 404，调用方需检查 `status`                               |
| 房间密钥分发接口       | `403` + forbidden                             | 当前客户端不应依赖该接口                                        |
| secure backup 缺少口令 | `400 Bad Request`                             | 高层/低层 manager 都会抛标准 API 错误                           |

## 事件系统

### `DeviceKeysManager`

| 事件                | 触发方法               | 载荷                  |
| ------------------- | ---------------------- | --------------------- |
| `KeysUploaded`      | `uploadKeys()`         | `one_time_key_counts` |
| `KeysQueried`       | `queryKeys()`          | `device_keys`         |
| `KeyClaimed`        | `claimKeys()`          | `one_time_keys`       |
| `DeviceListUpdated` | `getKeyChanges()`      | `changed[]`, `left[]` |
| `RoomKeyRequested`  | `getRoomKeyRequests()` | `requests[]`          |

### `DeviceTrustManager`

| 事件                     | 触发方法                      | 载荷                          |
| ------------------------ | ----------------------------- | ----------------------------- |
| `VerificationRequested`  | `requestVerification()`       | `IDeviceVerificationResponse` |
| `VerificationResponded`  | `respondToVerification()`     | `IVerificationRespondResult`  |
| `SecuritySummaryUpdated` | `getSecuritySummary()` 成功后 | `ISecuritySummary`            |
| `TrustChanged`           | 当前代码中未看到直接触发点    | 预留事件                      |

## 当前对齐结论

- 文档已按“后端真实契约 + SDK 当前封装行为”同步，不再把 `E2EEManager` 误写为唯一主入口。
- `DeviceTrustManager` 是当前最可靠的设备验证入口；`DeviceKeysManager` 中的验证 helper 已补齐后端兼容字段，仍以兼容层定位保留。
- `room_key_distribution` 已标注为当前不可用客户端接口。
- secure backup 文档已明确区分后端扩展字段与 SDK 高层稳定字段。
- `spec/unit/e2ee-manager.spec.ts` 已新增专用断言，覆盖生成路由绑定、验证请求参数语义与 `getSecuritySummary()` fallback。

## DTO Definitions

> Source: `src/e2ee/__generated__/dto.ts`

```typescript
// ─── Keys Upload ───────────────────────────────────────────────
export interface DeviceKeyData {
    user_id?: string;
    device_id?: string;
    algorithms?: string[];
    keys?: Record<string, string>;
    signatures?: Record<string, Record<string, string>>;
}
export interface UploadKeysRequest {
    device_keys?: DeviceKeyData;
    one_time_keys?: Record<string, Record<string, string>>;
}
export interface UploadKeysResponse {
    one_time_key_counts: Record<string, number>;
}

// ─── Keys Query ────────────────────────────────────────────────
export interface QueryKeysRequest {
    device_keys: Record<string, string[]>;
    timeout?: number;
    token?: string;
}
export interface CrossSigningKey {
    user_id?: string;
    usage?: string[];
    keys?: Record<string, string>;
    signatures?: Record<string, Record<string, string>>;
}
export interface QueryKeysResponse {
    device_keys: Record<string, Record<string, DeviceKeyData>>;
    failures: Record<string, { error?: string; message?: string }>;
    master_keys: Record<string, CrossSigningKey>;
    self_signing_keys: Record<string, CrossSigningKey>;
    user_signing_keys: Record<string, CrossSigningKey>;
}

// ─── Keys Claim ────────────────────────────────────────────────
export interface ClaimKeysRequest {
    one_time_keys: Record<string, Record<string, string>>;
    timeout?: number;
}
export interface ClaimKeysResponse {
    one_time_keys: Record<string, Record<string, Record<string, Record<string, string>>>>;
    failures: Record<string, { error?: string; message?: string }>;
}

// ─── Key Changes ───────────────────────────────────────────────
export interface KeyChangesResponse {
    changed: string[];
    left: string[];
}

// ─── Send To Device ────────────────────────────────────────────
export type SendToDeviceMessages = Record<string, Record<string, Record<string, unknown>>>;
export interface SendToDeviceRequest {
    messages: SendToDeviceMessages;
}

// ─── Signatures ────────────────────────────────────────────────
export interface UploadSignaturesRequest {
    [userId: string]: Record<string, Record<string, unknown>>;
}
export interface UploadSignaturesResponse {
    failures: Record<string, Record<string, unknown>>;
}

// ─── Device Signing ────────────────────────────────────────────
export interface UploadDeviceSigningRequest {
    master_key?: CrossSigningKey;
    self_signing_key?: CrossSigningKey;
    user_signing_key?: CrossSigningKey;
    auth?: { type: string; session?: string; [key: string]: unknown };
}

// ─── Room Key Request ──────────────────────────────────────────
export interface RoomKeyRequestRequest {
    action: "request" | "cancel_request";
    requesting_device_id: string;
    request_id: string;
    room_id?: string;
    session_id?: string;
    algorithm?: string;
    devices?: Array<{ user_id: string; device_id: string }>;
}

// ─── Device Verification (v3-only) ────────────────────────────
export interface DeviceVerificationRequest {
    user_id?: string;
    new_device_id?: string;
    device_id?: string;
    method?: string;
}
export interface DeviceVerificationResponse {
    transaction_id?: string;
    state?: string;
    device_id?: string;
    verified?: boolean;
}
export interface DeviceVerificationStatusResponse {
    token: string;
    state: "pending" | "verified" | "cancelled" | "expired";
    device_id?: string;
    requested_ts?: number;
    completed_ts?: number;
}

// ─── Device Trust (v3-only) ───────────────────────────────────
export interface DeviceTrustEntry {
    device_id: string;
    user_id?: string;
    trust_level?: "verified" | "cross_signed" | "unverified" | "unknown";
    display_name?: string;
    last_seen_ts?: number;
    last_seen_ip?: string;
}
export interface DeviceTrustListResponse {
    devices: DeviceTrustEntry[];
}
export interface DeviceTrustResponse {
    device_id: string;
    trust_level: "verified" | "cross_signed" | "unverified" | "unknown";
    display_name?: string;
    last_seen_ts?: number;
    last_seen_ip?: string;
}

// ─── Security Summary (v3-only) ───────────────────────────────
export interface SecuritySummaryResponse {
    verified_devices: number;
    unverified_devices: number;
    key_backup_configured: boolean;
    cross_signing_setup: boolean;
    backed_up_sessions?: number;
    total_sessions?: number;
}

// ─── Secure Backup (v3-only) ──────────────────────────────────
export interface SecurityBackupCreateRequest {
    algorithm?: string;
    auth_data?: Record<string, unknown>;
    passphrase?: string;
}
export interface SecurityBackupCreateResponse {
    version: string;
    algorithm: string;
}
export interface SecurityBackupListResponse {
    backups: Array<{ version: string; algorithm: string; auth_data?: Record<string, unknown> }>;
}
export interface SecurityBackupGetResponse {
    version: string;
    algorithm: string;
    auth_data?: Record<string, unknown>;
    count?: number;
    etag?: string;
}
export interface SecureBackupStoreKeysRequest {
    keys: Record<string, Record<string, unknown>>;
}
export interface SecureBackupStoreKeysResponse {
    count: number;
    etag: string;
}
export interface SecureBackupRestoreRequest {
    rooms?: string[];
    passphrase?: string;
    key?: string;
}
export interface SecureBackupRestoreResponse {
    recovered_keys: number;
    total_keys: number;
}
export interface SecureBackupVerifyRequest {
    passphrase?: string;
    key?: string;
}
export interface SecureBackupVerifyResponse {
    valid: boolean;
    algorithm?: string;
}

// ─── Device List Update ───────────────────────────────────────
export interface DeviceListUpdateRequest {
    users: string[];
}
export interface DeviceListUpdateResponse {
    changed?: string[];
    left?: string[];
}

// ─── Room Key Distribution ────────────────────────────────────
export interface RoomKeyDistributionResponse {
    room_id: string;
    devices?: Array<{ user_id: string; device_id: string }>;
    status?: string;
}
```
