---
module: e2ee
generated_from: docs/api-contract/generated/modules/e2ee.json
generated_hash: sha256-9ec3a6493baa92e077c5bf3c4738ee7d78b9af36199dbd842988f9d7c16a8414
ledger_schema: 4
last_reviewed: 2026-05-11
---

# E2EE API 契约

> 审查来源: `synapse-rust/synapse-web/src/routes/e2ee/mod.rs`
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

## 实现口径补充（2026-10-17 后端契约回灌）

> 本节依据 `synapse-rust/docs/sdk/e2ee.md` 回灌，补齐正文未覆盖或与后端不一致的行为。正文路由表的路由行、计数与日期保持不变；若正文与本节冲突，以本节为准。

### 密钥上传 `/keys/upload`

- 完全空 body `{}` 返回 `200` 与 `{"one_time_key_counts": {}}`，规范允许空体，不返回 400。
- 只传 `one_time_keys` 或只传 `fallback_keys` 均允许，不会覆盖已有 `device_keys`。
- `device_keys.keys` 为空对象返回 `400 M_BAD_JSON`（`device_keys.keys must be a non-empty object`）。
- 缺少 `device_id` 且 token 未绑定设备时返回 `400 M_BAD_JSON`（`Device ID required`）；`/keys/upload/{device_id}` 从路径取设备 ID。
- `one_time_keys` 的值形状是 `{"key": "<base64>"}`；fallback key 只能放在 `fallback_keys`，值形如 `{"key": "...", "fallback": true}`。不存在 `fallback_key` 字段，历史文档中的 `{key, fallback_key}` 写法是错的。
- 补传时机看 `/sync` 的 `device_one_time_keys_count`，低于阈值时补传；fallback key 是否缺失看 `device_unused_fallback_key_types`。

### 查询密钥 `/keys/query`

- 请求 `{"device_keys": {"@bob:matrix.test": []}}`，空数组表示该用户全部设备。
- 响应包含 `device_keys`、`master_keys`、`self_signing_keys`、`user_signing_keys`、`failures`。
- `verified_devices` 是本仓扩展，由服务端记录；不能替代客户端基于 master key 与 self-signing key 的签名校验。
- 请求中列出的用户一定会出现在响应里（即使没有设备也返回空对象），以保证客户端能清除 dirty 标记。
- 远端用户经联邦实时拉取，失败时进入 `failures`，键是 server_name、值是错误串；应视为暂时不可达并稍后重试，不能等同于“该用户没有加密设备”。
- 请求的 `device_keys` 为空对象时，服务端返回与当前用户有共享房间的用户加自己。

### 设备变更 `/keys/changes`

- 响应 `{"changed": ["@bob:matrix.test"], "left": ["@carol:matrix.test"]}`。
- `changed` 与 `left` 都是 user_id 字符串数组，不是 `{user: [devices]}` 映射；历史文档写成映射是错的。
- 两个列表都已按共享房间过滤；正常运行时无需轮询该端点，`/sync` 的 `device_lists` 已包含同样信息。

### Cross-Signing 与签名上传

- `POST /keys/device_signing/upload` 需要 UIA；不带 `auth` 返回 `401` 并给出 `flows` / `session`。
- `master_key`、`self_signing_key`、`user_signing_key` 至少提供一个，否则 `400 M_BAD_JSON`；空 `{}` 键对象会被跳过，不算提供。
- 成功响应是 `{}`；上传成功会唤醒长轮询的 `/sync`。
- `POST /keys/signatures/upload` 成功返回 `{"failures": {}}`；个别签名无效时按 `user_id → device_id → 错误串` 写入 `failures`。

### 密钥变更历史 `/keys/history`

- `GET /_matrix/client/v3/keys/history?limit=100&from=<cursor>`。
- `limit` 默认 100，夹在 `1..=1000`；仅当返回条数刚好等于 `limit` 时给出 `next_batch`。
- 该端点是服务端密钥变更审计视图，返回 `{history: [...], next_batch?}`；与规范中按 `device_id` 分组的设备级历史不同，设备级历史需查 `/keys/query`。

### 服务端安全备份 `/keys/backup/secure`

- `POST /keys/backup/secure` 需 `algorithm` 与 `auth_data`，返回 `{backup_id, version, algorithm, auth_data, key_count}`；正文“仅强制要求 `passphrase`”与后端不符。
- `GET /keys/backup/secure` 的响应是 `backup_id → 对象` 的映射，不是数组。
- `POST /keys/backup/secure/{backup_id}/keys` 返回 `{count, key_count}`。
- `POST /keys/backup/secure/{backup_id}/restore` 返回 `{total_keys, sessions}`，其中 `sessions` 是密文，客户端自行解密；正文的 `{success, restored_keys, key_count, message?}` 与后端不符。
- `POST` 与 `GET /keys/backup/secure/{backup_id}/verify` 均受支持。
- `room_keys` 是标准 Matrix 面，`keys/backup/secure` 是本仓私有面，新客户端应优先使用 `room_keys`。

### Megolm 密钥轮换（9 组端点）

- `GET /_matrix/vendor/v1/keys/rotation/status`
- `POST /_matrix/vendor/v1/keys/rotation/status`
- `GET /_matrix/vendor/v1/keys/rotation/check`
- `POST /_matrix/vendor/v1/keys/rotation/rotate`
- `POST /_matrix/vendor/v1/keys/rotation/revoke`
- `GET /_matrix/vendor/v1/keys/rotation/history/{device_id}`
- `GET /_matrix/vendor/v1/keys/rotation/config`
- `PUT /_matrix/vendor/v1/keys/rotation/config`
- `POST /_matrix/vendor/v1/keys/rotation/config`
- 服务端自动轮换由 `server.megolm_device_id` 开关控制，未配置时不启用轮换服务。
- 轮换判定只看每个 `(room_id, sender_key)` 的最新记录（`DISTINCT ON`），不会因历史行超期而反复要求轮换。

### 脱水设备（MSC3814）

- `PUT /_matrix/client/unstable/org.matrix.msc3814.v1/dehydrated_device` 上传脱水设备密钥，体含 `device_keys` 与 `device_data`。
- `GET` 同路径取当前脱水设备，`DELETE` 同路径删除。
- `GET .../dehydrated_device/status` 返回状态。
- `GET .../dehydrated_device/{device_id}/events?next_batch=` 拉取事件，`next_batch` 为 `null` 表示没有更多。
- `POST .../dehydrated_device/{device_id}/events` 上报已消费事件。
- 能力位为 `/versions` 中的 `org.matrix.msc3814`。

### 与 `/sync` 的 E2EE 字段

- `to_device.events`：处理 to-device 的 `m.room.encrypted`、`m.room_key` 与验证事件。
- `device_lists.changed` / `device_lists.left`：触发 `/keys/query` 或丢弃密钥缓存。
- `device_one_time_keys_count`：判断是否需要补传 OTK。
- `device_unused_fallback_key_types`：判断是否需要补 fallback key。
- `key_rotation_needed.rooms`：需要客户端轮换 megolm 会话的房间。
- `device_list_changes`：`{users: {uid: {change_type, device_count?}}, changed_count, left_count}`，与 `device_lists` 并列下发，不是同义副本。
