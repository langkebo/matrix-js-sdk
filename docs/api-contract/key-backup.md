---
module: key_backup
generated_from: docs/api-contract/generated/modules/key_backup.json
generated_hash: sha256-dabf89c9f756c8af2de209d2d85137c1bfb668dc7b4d1c07817111159d1a97ad
ledger_schema: 1
last_reviewed: 2026-05-11
---

# Key Backup 模块 API 审计报告

> 审计日期: 2026-05-11
> 后端实现: `/Users/ljf/Desktop/hu_ts/synapse-rust/src/web/routes/key_backup.rs`
> 对应 SDK 模块: `src/key-backup/index.ts`

## 本轮复核发现

- 旧文档的统计口径已经严重过时。当前机器可读契约是 `99` 条前缀展开端点，对应 `33` 条逻辑相对路径，而不是旧版文档中的 `32` 条。
- 后端 `/_matrix/client/{v1,r0,v3}/room_keys/keys*` 现在完整提供 `GET / PUT / DELETE` 三组读写删除路由；SDK 本轮已补齐原先缺失的房间级 `PUT` 与三组 `DELETE` wrapper。
- `getRoomKeys()` 的真实响应是 `{ sessions: ... }`，不是旧文档里暗示的 `{ rooms: ... }`。
- `getSessionKey()` 的真实响应是单个 `session_data` payload，本轮已把 SDK 返回类型从恢复接口包裹对象修正为原始 session payload。
- `POST /room_keys/version` 后端仅读 `algorithm` + `auth_data`（`key_backup.rs` `create_backup` 不处理 UIA `auth`）；SDK `createBackupVersion()` 不暴露 `auth` 参数（ISSUE-6.3：口令/令牌不应上送服务端，客户端派生密钥）。

## 路由分组

| 类别                    | 逻辑端点数 | 后端实现 | SDK 封装                        |
| ----------------------- | ---------- | -------- | ------------------------------- |
| 备份版本管理            | 5          | ✅ 完整  | ✅ 已封装                       |
| Spec 主路径密钥读写删除 | 9          | ✅ 完整  | ✅ 已封装                       |
| Legacy 路径别名         | 9          | ✅ 完整  | ℹ️ 不单独暴露，沿用同一 handler |
| 恢复与校验              | 6          | ✅ 完整  | ✅ 已封装                       |
| 导入与导出              | 4          | ✅ 完整  | ✅ 已封装                       |

## SDK 对齐结论

- `src/key-backup/index.ts` 已绑定生成的 `KeyBackupPathPattern`，主链路统一走 `ClientPrefix.V3`。
- `KeyBackupManager` 当前覆盖的 v3 主路径包括:
    - `GET/POST /room_keys/version`
    - `GET/PUT/DELETE /room_keys/version/{version}`
    - `GET/PUT/DELETE /room_keys/keys`
    - `GET/PUT/DELETE /room_keys/keys/{room_id}`
    - `GET/PUT/DELETE /room_keys/keys/{room_id}/{session_id}`
    - `POST /room_keys/recover`
    - `GET /room_keys/recovery/{version}/progress`
    - `GET /room_keys/verify/{version}`
    - `POST /room_keys/batch_recover`
    - `GET /room_keys/recover/{version}/{room_id}`
    - `GET /room_keys/recover/{version}/{room_id}/{session_id}`
    - `GET /room_keys/export[/{version}]`
    - `POST /room_keys/import[/{version}]`
- `/_matrix/client/{v1,r0}/room_keys/{version}/keys...` 这组 legacy 别名仍由后端同一 handler 承接，SDK 不再额外提供重复方法。

## 关键请求与返回

### 版本管理

- `getLatestBackupVersion()` / `getBackupVersion()` 读取后端真实结构:

```json
{
    "version": "1",
    "algorithm": "m.megolm_backup.v1.curve25519-aes-sha2",
    "auth_data": { "public_key": "..." },
    "count": 7,
    "etag": "7"
}
```

- `createBackupVersion(algorithm, authData?)` 请求体仅含 `algorithm` + `auth_data`（客户端派生 curve25519 公钥后上传，口令/私钥永不上送服务端）:

```json
{
    "algorithm": "m.megolm_backup.v1.curve25519-aes-sha2",
    "auth_data": { "public_key": "..." }
}
```

### 密钥读写删除

- `getAllRoomKeys(version)` 返回:

```json
{
    "rooms": {
        "!room:example.com": {
            "sessions": {
                "sess1": {
                    "first_message_index": 0,
                    "forwarded_count": 0,
                    "is_verified": true,
                    "session_data": { "ciphertext": "...", "mac": "...", "ephemeral": "..." }
                }
            }
        }
    }
}
```

- `getRoomKeys(version, roomId)` 返回:

```json
{
    "sessions": {
        "sess1": {
            "first_message_index": 0,
            "forwarded_count": 0,
            "is_verified": true,
            "session_data": { "ciphertext": "...", "mac": "...", "ephemeral": "..." }
        }
    }
}
```

- `getSessionKey(version, roomId, sessionId)` 返回后端原始 `session_data`，不是恢复接口的包裹对象:

```json
{
    "ciphertext": "...",
    "mac": "...",
    "ephemeral": "..."
}
```

- `putAllRoomKeys()`、`putRoomKeys()`、`putSessionKey()` 以及三组删除接口都返回统一写响应:

```json
{
    "etag": "1_1715412345678",
    "count": 4
}
```

## 错误语义

| 场景                          | 后端行为          | SDK 表现                                             |
| ----------------------------- | ----------------- | ---------------------------------------------------- |
| `auth_data` 缺少 `public_key` | `400 Bad Request` | `createBackupVersion()` 抛标准化错误                 |
| 备份版本不存在                | `404 Not Found`   | 相关 `get* / put* / delete* / recover*` 方法抛标准化错误 |
| 会话不存在                    | `404 Not Found`   | `getSessionKey()` / `recoverSessionKey()` 抛标准化错误 |

## 人工 Review 对齐

- `spec/unit/key-backup.spec.ts` 已补:
    - 版本读取 `count` / `etag`
    - `createBackupVersion()`（`algorithm` + `auth_data`，无 `auth`）
    - `putRoomKeys()`
    - `deleteAllRoomKeys()` / `deleteRoomKeys()` / `deleteSessionKey()`
    - `getSessionKey()` 的真实返回结构
- `MatrixClient.deleteKeysFromBackup()` 仍保留为较旧的客户端级 helper；`KeyBackupManager` 现在提供更完整、类型更清晰的高层封装。
- Secure backup 相关接口已迁移到 `e2ee.md` / `secure-backup` 语义，不再混写进本模块的覆盖率统计。

## 封装覆盖率

- **机器可读契约端点数**: 99
- **逻辑相对路径数**: 33
- **SDK 主路径覆盖**: 33/33
- **已绑定生成路由模板**: 21/21 个 `KeyBackupManager` v3 调用点
- **契约覆盖率**: 100%

## DTO Definitions

> Source: `src/key-backup/__generated__/dto.ts`

```typescript
export interface EncryptedData {
    ciphertext: string;
    ephemeral: string;
    mac: string;
}
export interface AuthData {
    public_key: string;
    signatures?: Record<string, Record<string, string>>;
}
export interface SessionData {
    first_message_index: number;
    forwarded_count: number;
    is_verified: boolean;
    session_data: EncryptedData | Record<string, unknown>;
}
export interface BackupVersionInfo {
    version: string;
    algorithm: string;
    auth_data: AuthData | Record<string, unknown>;
    count?: number;
    etag?: string;
}
export interface RoomSessions {
    sessions: Record<string, SessionData>;
}
export interface RoomKeyBackup {
    rooms: Record<string, RoomSessions>;
    etag: string;
}
export interface RecoveryProgress {
    user_id: string;
    version: string;
    total_keys: number;
    recovered_keys: number;
    status: string;
    started_ts: number;
    updated_ts: number;
}
export interface BatchRecoverResult {
    rooms: Record<string, RoomSessions>;
    total_sessions: number;
    has_more: boolean;
    next_batch?: string;
}
export interface ExportedRoomKey {
    room_id: string;
    session_id: string;
    session_data: EncryptedData | Record<string, unknown>;
    first_message_index: number;
    forwarded_count: number;
    is_verified: boolean;
}
export interface ExportResult {
    room_keys: ExportedRoomKey[];
    version: string;
}
export interface ImportResult {
    count: number;
    failed: number;
    total: number;
}
export interface VerifyResult {
    valid: boolean;
    algorithm: string;
    auth_data: AuthData | Record<string, unknown>;
    key_count: number;
    signatures?: Record<string, Record<string, string>>;
}
export interface PutRoomKeysBody {
    rooms: Record<string, RoomSessions>;
}
export interface PutRoomSessionsBody {
    sessions: Record<string, SessionData>;
}
export interface CreateBackupVersionRequest {
    algorithm: string;
    auth_data?: AuthData | Record<string, unknown>;
}
export interface UpdateBackupVersionRequest {
    auth_data: AuthData | Record<string, unknown>;
}
export interface RecoverKeysRequest {
    version: string;
    rooms?: string[];
}
export interface BatchRecoverRequest {
    version: string;
    room_ids: string[];
    session_limit?: number;
}
export interface ImportKeysRequest {
    room_keys: ExportedRoomKey[];
    version?: string;
}
export interface CreateBackupVersionResponse {
    version: string;
}
export interface DeleteBackupVersionResponse {
    deleted: boolean;
    version: string;
}
export interface UploadKeysResult {
    count: number;
    etag: string;
}
export interface RecoverKeysResult {
    rooms: Record<string, RoomSessions>;
    total_keys: number;
    recovered_keys: number;
}
export interface RecoverRoomKeysResult {
    room_id: string;
    sessions: SessionData[];
}
export interface RecoverSessionKeyResult {
    room_id: string;
    session_id: string;
    session_data: EncryptedData | Record<string, unknown>;
}
```
