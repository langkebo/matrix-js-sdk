---
module: key_backup
generated_from: docs/api-contract/generated/modules/key_backup.json
generated_hash: sha256-c2217add8c57e388b1d2af96203431df76b59118cf5197ff1ed7ba45702c45d2
ledger_schema: 1
last_reviewed: 2026-05-03
---

# Key Backup 模块 API 审计报告

> 审计日期: 2026-04-04
> 修复日期: 2026-04-04
> 契约文档: `/Users/ljf/Desktop/hu/matrix-js-sdk/docs/api-contract/key-backup.md`
> 后端实现: `/Users/ljf/Desktop/hu/synapse-rust/src/web/routes/key_backup.rs`

---

## 1. 审计范围

| 类别          | 端点数量 | 后端实现                 | SDK 封装                                |
| ------------- | -------- | ------------------------ | --------------------------------------- |
| 备份版本管理  | 5        | ✅ 完整                  | ✅ 已封装                               |
| 备份密钥读写  | 11       | ✅ 完整                  | ⚠️ 7 个精确对齐，4 个兼容别名未单独封装 |
| 恢复与校验    | 6        | ✅ 完整                  | ✅ 已封装                               |
| 导出与导入    | 4        | ✅ 完整                  | ✅ 已封装                               |
| Secure Backup | 6        | ✅ 完整 (e2ee_routes.rs) | ✅ 已封装                               |

---

## 2. 详细比对结果

### 2.1 备份版本管理端点

| 端点                                  | 契约定义 | 后端实现             | SDK 封装                                    | 状态      |
| ------------------------------------- | -------- | -------------------- | ------------------------------------------- | --------- |
| `GET /room_keys/version`              | ✅       | ✅ key_backup.rs:35  | ✅ `KeyBackupManager.getBackupVersions()`   | ✅ OK     |
| `POST /room_keys/version`             | ✅       | ✅ key_backup.rs:53  | ✅ `KeyBackupManager.createBackupVersion()` | ✅ OK     |
| `GET /room_keys/version/{version}`    | ✅       | ✅ key_backup.rs:71  | ✅ `KeyBackupManager.getBackupVersion()`    | ✅ OK     |
| `PUT /room_keys/version/{version}`    | ✅       | ✅ key_backup.rs:89  | ✅ `KeyBackupManager.updateBackupVersion()` | ✅ 已添加 |
| `DELETE /room_keys/version/{version}` | ✅       | ✅ key_backup.rs:107 | ✅ `KeyBackupManager.deleteBackupVersion()` | ✅ OK     |

| `GET /room_keys/keys` | ✅ | ✅ key_backup.rs:24 | ✅ `KeyBackupManager.getAllBackupKeys()` | ✅ OK |
| `PUT /room_keys/keys` | ✅ | ✅ key_backup.rs:24 | ✅ `KeyBackupManager.uploadKeysToLatest()` | ✅ OK |
| `GET /room_keys/keys/{version}` | ✅ | ✅ key_backup.rs:28 | ✅ `KeyBackupManager.getBackupKeys()` | ✅ OK |
| `PUT /room_keys/keys/{version}` | ✅ | ✅ key_backup.rs:28 | ✅ `KeyBackupManager.uploadKeysToVersion()` | ✅ OK |
| `GET /room_keys/keys/{version}/{room_id}` | ✅ | ✅ key_backup.rs:32 | ✅ `KeyBackupManager.getRoomBackupKeys()` | ✅ OK |
| `GET /room_keys/keys/{version}/{room_id}/{session_id}` | ✅ | ✅ key_backup.rs:36 | ✅ `KeyBackupManager.getSessionBackupKey()` | ✅ OK |
| `GET /room_keys/{version}` | ✅ | ✅ key_backup.rs:40 | ⚠️ 无独立 SDK 方法 | ℹ️ 后端兼容别名 |
| `PUT /room_keys/{version}` | ✅ | ✅ key_backup.rs:40 | ⚠️ 无独立 SDK 方法 | ℹ️ 后端兼容别名 |
| `POST /room_keys/{version}/keys` | ✅ | ✅ key_backup.rs:43 | ✅ `KeyBackupManager.uploadBatchKeys()` | ✅ OK |
| `GET /room_keys/{version}/keys/{room_id}` | ✅ | ✅ key_backup.rs:45 | ⚠️ 无独立 SDK 方法 | ℹ️ 后端兼容别名 |
| `GET /room_keys/{version}/keys/{room_id}/{session_id}` | ✅ | ✅ key_backup.rs:49 | ⚠️ 无独立 SDK 方法 | ℹ️ 后端兼容别名 |
| `POST /room_keys/recover` | ✅ | ✅ key_backup.rs:269 | ✅ `KeyBackupManager.recoverKeys()` | ✅ OK |
| `GET /room_keys/recovery/{version}/progress` | ✅ | ✅ key_backup.rs:287 | ✅ `KeyBackupManager.getRecoveryProgress()` | ✅ 已添加 |
| `GET /room_keys/verify/{version}` | ✅ | ✅ key_backup.rs:305 | ✅ `KeyBackupManager.verifyBackup()` | ✅ 已添加 |
| `POST /room_keys/batch_recover` | ✅ | ✅ key_backup.rs:323 | ✅ `KeyBackupManager.batchRecover()` | ✅ 已添加 |
| `GET /room_keys/recover/{version}/{room_id}` | ✅ | ✅ key_backup.rs:341 | ✅ `KeyBackupManager.recoverRoomKeys()` | ✅ 已添加 |
| `GET /room_keys/recover/{version}/{room_id}/{session_id}` | ✅ | ✅ key_backup.rs:359 | ✅ `KeyBackupManager.recoverSessionKey()` | ✅ 已添加 |
| `GET /room_keys/export` | ✅ | ✅ key_backup.rs:377 | ✅ `KeyBackupManager.exportKeys()` | ✅ OK |
| `GET /room_keys/export/{version}` | ✅ | ✅ key_backup.rs:395 | ✅ `KeyBackupManager.exportKeysByVersion()` | ✅ OK |
| `POST /room_keys/import` | ✅ | ✅ key_backup.rs:413 | ✅ `KeyBackupManager.importKeys()` | ✅ OK |
| `POST /room_keys/import/{version}` | ✅ | ✅ key_backup.rs:431 | ✅ `KeyBackupManager.importKeysToVersion()` | ✅ OK |

| `POST /keys/backup/secure` | ✅ | ✅ secure-backup/index.ts:43 | ✅ `SecureBackupManager.createSecureBackup()` | ✅ OK |
| `GET /keys/backup/secure/{backup_id}` | ✅ | ✅ secure-backup/index.ts:57 | ✅ `SecureBackupManager.getSecureBackup()` | ✅ OK |
| `DELETE /keys/backup/secure/{backup_id}` | ✅ | ✅ secure-backup/index.ts:71 | ✅ `SecureBackupManager.deleteSecureBackup()` | ✅ OK |
| `POST /keys/backup/secure/{backup_id}/keys` | ✅ | ✅ secure-backup/index.ts:85 | ✅ `SecureBackupManager.addKeysToSecureBackup()` | ✅ 已添加 |
| `POST /keys/backup/secure/{backup_id}/restore` | ✅ | ✅ secure-backup/index.ts:107 | ✅ `SecureBackupManager.restoreFromSecureBackup()` | ✅ OK |
| `POST /keys/backup/secure/{backup_id}/verify` | ✅ | ✅ secure-backup/index.ts:121 | ✅ `SecureBackupManager.verifySecureBackup()` | ✅ OK |

补充核对结果：

- `KeyBackupManager.uploadSessionKey()` 调用的 `PUT /room_keys/keys/{version}/{room_id}/{session_id}` 已在后端挂载，路径本身无误。
- 后端额外提供 `/_matrix/client/{v1,r0,v3}/room_keys/{version}` 及其子路径作为兼容别名，SDK 目前未单独暴露这些别名方法。

---

## 3. 已修复问题

| 问题                         | 当前状态                        | 文件                     |
| ---------------------------- | ------------------------------- | ------------------------ |
| SDK 使用间接封装             | ✅ 已重构为直接 HTTP 调用       | `key-backup/index.ts`    |
| 缺少恢复与校验功能           | ✅ 已补齐 6 个方法              | `key-backup/index.ts`    |
| 缺少导入导出功能             | ✅ 已补齐 4 个方法              | `key-backup/index.ts`    |
| 缺少 Secure Backup 封装      | ✅ 已添加 `SecureBackupManager` | `secure-backup/index.ts` |
| 单会话上传路径被误判为未挂载 | ✅ 已核对后端实际挂载情况       | `key-backup.md`          |

---

## 4. 鷻加的接口

```typescript
export interface BackupVersionInfo {
    version: string;
    algorithm: string;
    auth_data: any;
}

export interface BackupVersion {
    version: string;
    algorithm: string;
    auth_data: any;
    count?: number;
    etag?: string;
}

export interface RoomKeyBackup {
    rooms: Record<string, {
        sessions: Record<string, {
            first_message_index: number;
            forwarded_count: number;
            is_verified: boolean;
            session_data: any;
        }>;
    } }>;
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
    rooms: Record<string, any>;
    total_sessions: number;
    has_more: boolean;
    next_batch?: string;
}

export interface ExportResult {
    room_keys: Array<{
        room_id: string;
        session_id: string;
        session_data: any;
    }>;
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
    auth_data: any;
    key_count: number;
    signatures?: any;
}

export interface SecureBackupInfo {
    backup_id: string;
    version: string;
    algorithm: string;
    auth_data: any;
    key_count: number;
}
```

---

## 5. 封装覆盖率

- **后端路由总数**: 32 个端点
- **精确对齐的 SDK 封装**: 28 个方法
- **后端兼容别名未单独封装**: 4 个端点
- **路径待修正的 SDK 方法**: 0 个（`uploadSessionKey()` 已核对为与后端挂载一致）

---

## 6. 騡块导出

```typescript
// key-backup/index.ts
export { KeyBackupManager } from "./key-backup";
export type {
    BackupVersionInfo,
    BackupVersion,
    RoomKeyBackup,
    RecoveryProgress,
    BatchRecoverResult,
    ExportResult,
    ImportResult,
    VerifyResult,
} from "./key-backup";

// secure-backup/index.ts
export { SecureBackupManager } from "./secure-backup";
export type { SecureBackupInfo } from "./secure-backup";
```

---

## 7. 测试策略

### 7.1 单元测试

```typescript
describe("KeyBackupManager", () => {
    it("should call correct API endpoints", async () => {
        // Mock HTTP client
        const mockHttp = {
            authedRequest: vi.fn(),
        };
        const client = {
            http: mockHttp,
        } as any;

        const manager = new KeyBackupManager(client);

        // Test version management
        await manager.getBackupVersions();
        expect(mockHttp.authedRequest).toHaveBeenCalledWith("GET", "/room_keys/version");

        await manager.createBackupVersion("m.megolm.v1.aes-sha2", { key: "value" });
        expect(mockHttp.authedRequest).toHaveBeenCalledWith("POST", "/room_keys/version");
    });
});
```

---

## 8. 结论

### 8.1 当前状态

- ✅ 后端实现完整，客户端前缀覆盖 `v1/r0/v3`
- ✅ 大多数 Key Backup / Secure Backup 能力已由 SDK 直接 HTTP 封装
- ⚠️ 仍有 4 个后端兼容别名未单独暴露
- ✅ `uploadSessionKey()` 使用的单会话 PUT 路径已确认由后端挂载

### 8.2 娡块功能

- ✅ 版本管理: 创建、更新、获取、删除备份版本
- ✅ 密钥读写: 蟥询、上传、批量上传密钥
- ✅ 恢复功能: 恢复密钥、获取恢复进度、批量恢复
- ✅ 校验功能: 验证备份完整性
- ✅ 导入导出: 导出/导入密钥
- ✅ Secure Backup: 口令驱动的安全备份
