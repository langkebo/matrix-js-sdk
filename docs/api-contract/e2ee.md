---
module: e2ee
generated_from: docs/api-contract/generated/modules/e2ee.json
generated_hash: sha256-3d4418a7893e871a931aab6f819f20f7185b401fdd2b5db6a8027d4ba93c3dde
ledger_schema: 4
last_reviewed: 2026-05-11
---

# E2EE API 契约

> 审查来源: `synapse-rust/src/web/routes/e2ee_routes.rs`
> 对应 SDK 模块: `src/device-keys/index.ts`, `src/secure-backup/index.ts`, `src/e2ee/index.ts`

## 本次复核结论

- 后端实际分为两层路由:
    - compat 路由同时挂在 `/_matrix/client/r0`、`/_matrix/client/v1`、`/_matrix/client/v3`
    - v3-only 路由只挂在 `/_matrix/client/v3`
- SDK 并不是单一 `E2EEManager` 封装，而是三层入口并存:
    - `DeviceKeysManager`: 设备密钥、签名、room key request、to-device
    - `SecureBackupManager`: secure backup 的高层类型化封装
    - `E2EEManager`: 面向后端原始端点的低层薄封装
- 后端 2026-09-25 已按规范拆除 `device_verification/*`、`device_trust*`、`security/summary`
  整套服务端托管设备私钥面（`m.key.verification.*` 是客户端之间的 to-device 流程），
  并有用例钉住这些端点必须 404（synapse-rust `tests/integration/api_verification_relay_tests.rs`）
  ⇒ SDK 侧 `src/device-trust/` 已删除，本节不再声明这些端点。
- `GET /rooms/{room_id}/keys/distribution` 当前后端直接返回 `403 Forbidden`，属于服务端内部接口，不是可正常消费的客户端业务 API。
- secure backup 后端返回字段比 SDK 高层类型更丰富，文档以下文“稳定字段 + SDK 实际消费字段”的方式说明。
- `E2EEManager` 现已绑定生成的 `E2eePathPattern`，并补齐 `createSecureBackup()` 的后端真实参数语义。

## 路由挂载

| 前缀                 | 真实后端暴露                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `/_matrix/client/r0` | compat: `keys/*`、`room_keys/request*`、`sendToDevice`、`rooms/{room_id}/keys/distribution` |
| `/_matrix/client/v1` | 同 r0                                                                                       |
| `/_matrix/client/v3` | compat 全量 + `keys/backup/secure*`                                                         |

## SDK 入口分层

| SDK 入口              | 主要职责                                                         | 说明                                                                              |
| --------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `DeviceKeysManager`   | 密钥上传/查询/claim、设备列表、签名、room key request、to-device | 高层类型较多，但部分返回结构落后于后端                                            |
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

| 方法     | 路径                                      | 后端行为                                               | SDK 主入口                                                                                |
| -------- | ----------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `POST`   | `/keys/backup/secure`                     | 仅强制要求 `passphrase`                                | `SecureBackupManager.createSecureBackup()` / `E2EEManager.createSecureBackup()`           |
| `GET`    | `/keys/backup/secure/{backup_id}`         | 返回 backup info                                       | `SecureBackupManager.getSecureBackup()` / `E2EEManager.getSecureBackup()`                 |
| `DELETE` | `/keys/backup/secure/{backup_id}`         | 删除备份                                               | `SecureBackupManager.deleteSecureBackup()` / `E2EEManager.deleteSecureBackup()`           |
| `POST`   | `/keys/backup/secure/{backup_id}/keys`    | 返回 `{ count, key_count }`                            | `SecureBackupManager.addKeysToSecureBackup()` / `E2EEManager.storeSecureBackupKeys()`     |
| `POST`   | `/keys/backup/secure/{backup_id}/restore` | 返回 `{ success, restored_keys, key_count, message? }` | `SecureBackupManager.restoreFromSecureBackup()` / `E2EEManager.restoreSecureBackup()`     |
| `POST`   | `/keys/backup/secure/{backup_id}/verify`  | 返回 `{ valid }`                                       | `SecureBackupManager.verifySecureBackup()` / `E2EEManager.verifySecureBackupPassphrase()` |

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

| 场景                   | 后端典型返回                                  | SDK 语义                              |
| ---------------------- | --------------------------------------------- | ------------------------------------- |
| 未认证 / token 无效    | `401` + `M_MISSING_TOKEN` / `M_UNKNOWN_TOKEN` | manager 统一归一化为鉴权错误          |
| 房间密钥分发接口       | `403` + forbidden                             | 当前客户端不应依赖该接口              |
| secure backup 缺少口令 | `400 Bad Request`                             | 高层/低层 manager 都会抛标准 API 错误 |

## 事件系统

### `DeviceKeysManager`

| 事件                | 触发方法               | 载荷                  |
| ------------------- | ---------------------- | --------------------- |
| `KeysUploaded`      | `uploadKeys()`         | `one_time_key_counts` |
| `KeysQueried`       | `queryKeys()`          | `device_keys`         |
| `KeyClaimed`        | `claimKeys()`          | `one_time_keys`       |
| `DeviceListUpdated` | `getKeyChanges()`      | `changed[]`, `left[]` |
| `RoomKeyRequested`  | `getRoomKeyRequests()` | `requests[]`          |

## 当前对齐结论

- 文档已按“后端真实契约 + SDK 当前封装行为”同步，不再把 `E2EEManager` 误写为唯一主入口。
- 后端 2026-09-25 拆除的 `device_verification/*` / `device_trust*` / `security/summary` 面
  在 SDK 侧已同步删除（`src/device-trust/` 模块与其生成表条目、豁免一并移除）。
- `room_key_distribution` 已标注为当前不可用客户端接口。
- secure backup 文档已明确区分后端扩展字段与 SDK 高层稳定字段。

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
