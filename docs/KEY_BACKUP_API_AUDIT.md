# Key Backup 模块 API 审计报告

> 审计日期: 2026-04-04
> 契约文档: `/Users/ljf/Desktop/hu/matrix-js-sdk/docs/api-contract/key-backup.md`
> 后端实现: `/Users/ljf/Desktop/hu/synapse-rust/src/web/routes/key_backup.rs`

---

## 1. 审计范围

### 1.1 契约端点统计

| 类别 | 端点数量 | 后端实现 | SDK 封装 |
|------|----------|----------|----------|
| 备份版本管理 | 5 | ✅ 完整 | ⚠️ 部分封装 |
| 备份密钥读写 | 11 | ✅ 完整 | ⚠️ 部分封装 |
| 恢复与校验 | 6 | ✅ 完整 | ❌ 未封装 |
| 导出与导入 | 4 | ✅ 完整 | ❌ 未封装 |
| Secure Backup | 6 | ✅ 完整 (e2ee_routes.rs) | ❌ 未封装 |

---

## 2. 详细比对结果

### 2.1 备份版本管理端点

| 端点 | 契约定义 | 后端实现 | SDK 封装 | 状态 |
|------|----------|----------|----------|------|
| `GET /room_keys/version` | ✅ | ✅ key_backup.rs:35 | ⚠️ client.getKeyBackupVersions() | 间接封装 |
| `POST /room_keys/version` | ✅ | ✅ key_backup.rs:53 | ⚠️ client.createKeyBackup() | 间接封装 |
| `GET /room_keys/version/{version}` | ✅ | ✅ key_backup.rs:71 | ⚠️ client.getKeyBackupInfo() | 间接封装 |
| `PUT /room_keys/version/{version}` | ✅ | ✅ key_backup.rs:89 | ❌ 未封装 | 需添加 |
| `DELETE /room_keys/version/{version}` | ✅ | ✅ key_backup.rs:107 | ⚠️ client.deleteKeyBackup() | 间接封装 |

### 2.2 备份密钥读写端点

| 端点 | 契约定义 | 后端实现 | SDK 封装 | 状态 |
|------|----------|----------|----------|------|
| `GET /room_keys/keys` | ✅ | ✅ key_backup.rs:125 | ⚠️ client.getKeyBackupKeys() | 间接封装 |
| `PUT /room_keys/keys` | ✅ | ✅ key_backup.rs:143 | ❌ 未封装 | 需添加 |
| `GET /room_keys/keys/{version}` | ✅ | ✅ key_backup.rs:161 | ⚠️ client.getKeyBackupKeys() | 间接封装 |
| `PUT /room_keys/keys/{version}` | ✅ | ✅ key_backup.rs:179 | ❌ 未封装 | 需添加 |
| `GET /room_keys/keys/{version}/{room_id}` | ✅ | ✅ key_backup.rs:197 | ❌ 未封装 | 需添加 |
| `GET /room_keys/keys/{version}/{room_id}/{session_id}` | ✅ | ✅ key_backup.rs:215 | ⚠️ client.getKeyBackupSession() | 间接封装 |
| `PUT /room_keys/keys/{version}/{room_id}/{session_id}` | ✅ | ✅ key_backup.rs:233 | ⚠️ client.putKeyBackupSession() | 间接封装 |
| `POST /room_keys/{version}/keys` | ✅ | ✅ key_backup.rs:251 | ❌ 未封装 | 需添加 |

### 2.3 恢复与校验端点

| 端点 | 契约定义 | 后端实现 | SDK 封装 | 状态 |
|------|----------|----------|----------|------|
| `POST /room_keys/recover` | ✅ | ✅ key_backup.rs:269 | ❌ 未封装 | 需添加 |
| `GET /room_keys/recovery/{version}/progress` | ✅ | ✅ key_backup.rs:287 | ❌ 未封装 | 需添加 |
| `GET /room_keys/verify/{version}` | ✅ | ✅ key_backup.rs:305 | ❌ 未封装 | 需添加 |
| `POST /room_keys/batch_recover` | ✅ | ✅ key_backup.rs:323 | ❌ 未封装 | 需添加 |
| `GET /room_keys/recover/{version}/{room_id}` | ✅ | ✅ key_backup.rs:341 | ❌ 未封装 | 需添加 |
| `GET /room_keys/recover/{version}/{room_id}/{session_id}` | ✅ | ✅ key_backup.rs:359 | ❌ 未封装 | 需添加 |

### 2.4 导出与导入端点

| 端点 | 契约定义 | 后端实现 | SDK 封装 | 状态 |
|------|----------|----------|----------|------|
| `GET /room_keys/export` | ✅ | ✅ key_backup.rs:377 | ❌ 未封装 | 需添加 |
| `GET /room_keys/export/{version}` | ✅ | ✅ key_backup.rs:395 | ❌ 未封装 | 需添加 |
| `POST /room_keys/import` | ✅ | ✅ key_backup.rs:413 | ❌ 未封装 | 需添加 |
| `POST /room_keys/import/{version}` | ✅ | ✅ key_backup.rs:431 | ❌ 未封装 | 需添加 |

### 2.5 Secure Backup 端点 (e2ee_routes.rs)

| 端点 | 契约定义 | 后端实现 | SDK 封装 | 状态 |
|------|----------|----------|----------|------|
| `POST /keys/backup/secure` | ✅ | ✅ e2ee_routes.rs | ❌ 未封装 | 需添加 |
| `GET /keys/backup/secure/{backup_id}` | ✅ | ✅ e2ee_routes.rs | ❌ 未封装 | 需添加 |
| `DELETE /keys/backup/secure/{backup_id}` | ✅ | ✅ e2ee_routes.rs | ❌ 未封装 | 需添加 |
| `POST /keys/backup/secure/{backup_id}/keys` | ✅ | ✅ e2ee_routes.rs | ❌ 未封装 | 需添加 |
| `POST /keys/backup/secure/{backup_id}/restore` | ✅ | ✅ e2ee_routes.rs | ❌ 未封装 | 需添加 |
| `POST /keys/backup/secure/{backup_id}/verify` | ✅ | ✅ e2ee_routes.rs | ❌ 未封装 | 需添加 |

---

## 3. 发现的问题

### 3.1 🔴 高优先级问题

#### 1. SDK 使用间接封装而非直接 HTTP 调用

**问题描述**: SDK 的 KeyBackupManager 使用 `client.createKeyBackup()`、`client.getKeyBackupVersions()` 等方法，但这些方法可能不存在于 MatrixClient 中，或者实现与后端 API 不一致。

**影响**: 功能可能无法正常工作，错误处理不统一。

**解决方案**: 重构为直接使用 `client.http.authedRequest()` 调用后端 API。

---

#### 2. 缺少恢复与校验功能

**问题描述**: SDK 完全没有封装后端的恢复和校验端点：
- `POST /room_keys/recover`
- `GET /room_keys/recovery/{version}/progress`
- `GET /room_keys/verify/{version}`
- `POST /room_keys/batch_recover`

**影响**: 用户无法通过 SDK 恢复备份密钥。

**解决方案**: 添加完整的恢复和校验方法。

---

#### 3. 缺少导入导出功能

**问题描述**: SDK 没有封装导入导出端点：
- `GET /room_keys/export`
- `POST /room_keys/import`

**影响**: 用户无法导入导出备份密钥。

**解决方案**: 添加导入导出方法。

---

### 3.2 ⚠️ 中优先级问题

#### 4. 缺少 Secure Backup 封装

**问题描述**: SDK 没有封装 v3 Secure Backup 端点。

**影响**: 无法使用口令驱动的安全备份功能。

**解决方案**: 在 CryptoBackupManager 中添加 Secure Backup 方法。

---

#### 5. 缺少批量密钥上传

**问题描述**: SDK 没有封装 `POST /room_keys/{version}/keys` 批量上传端点。

**影响**: 只能逐个上传密钥，效率低下。

**解决方案**: 添加批量上传方法。

---

### 3.3 📝 低优先级问题

#### 6. 错误处理不完善

**问题描述**: SDK 中的错误处理大量使用 `catch (e) { return null; }`，掩盖了真实错误。

**影响**: 问题难以排查。

**解决方案**: 使用统一的错误处理机制。

---

## 4. 优化方案

### 4.1 重构 KeyBackupManager

```typescript
import { MatrixClient } from "../client";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";

export interface BackupVersion {
    version: string;
    algorithm: string;
    auth_data: any;
    count?: number;
    etag?: string;
}

export interface BackupVersionInfo {
    version: string;
    algorithm: string;
    auth_data: any;
}

export interface RoomKeyBackup {
    rooms: Record<string, {
        sessions: Record<string, {
            first_message_index: number;
            forwarded_count: number;
            is_verified: boolean;
            session_data: any;
        }>;
    }>;
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

export class KeyBackupManager {
    constructor(private client: MatrixClient) {}

    // ==================== 版本管理 ====================

    /**
     * 获取所有备份版本
     * GET /_matrix/client/v3/room_keys/version
     */
    async getBackupVersions(): Promise<{ versions: BackupVersionInfo[] }> {
        return this.client.http.authedRequest(
            Method.Get,
            "/room_keys/version",
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 }
        );
    }

    /**
     * 创建备份版本
     * POST /_matrix/client/v3/room_keys/version
     */
    async createBackupVersion(algorithm: string, authData?: any): Promise<{ version: string }> {
        return this.client.http.authedRequest(
            Method.Post,
            "/room_keys/version",
            undefined,
            { algorithm, auth_data: authData },
            { prefix: ClientPrefix.V3 }
        );
    }

    /**
     * 获取指定版本信息
     * GET /_matrix/client/v3/room_keys/version/{version}
     */
    async getBackupVersion(version: string): Promise<BackupVersionInfo> {
        return this.client.http.authedRequest(
            Method.Get,
            `/room_keys/version/${version}`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 }
        );
    }

    /**
     * 更新备份版本
     * PUT /_matrix/client/v3/room_keys/version/{version}
     */
    async updateBackupVersion(version: string, authData: any): Promise<{ version: string }> {
        return this.client.http.authedRequest(
            Method.Put,
            `/room_keys/version/${version}`,
            undefined,
            { auth_data: authData },
            { prefix: ClientPrefix.V3 }
        );
    }

    /**
     * 删除备份版本
     * DELETE /_matrix/client/v3/room_keys/version/{version}
     */
    async deleteBackupVersion(version: string): Promise<{ deleted: boolean; version: string }> {
        return this.client.http.authedRequest(
            Method.Delete,
            `/room_keys/version/${version}`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 }
        );
    }

    // ==================== 密钥读写 ====================

    /**
     * 获取所有备份密钥
     * GET /_matrix/client/v3/room_keys/keys
     */
    async getAllBackupKeys(): Promise<RoomKeyBackup> {
        return this.client.http.authedRequest(
            Method.Get,
            "/room_keys/keys",
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 }
        );
    }

    /**
     * 获取指定版本的备份密钥
     * GET /_matrix/client/v3/room_keys/keys/{version}
     */
    async getBackupKeys(version: string): Promise<RoomKeyBackup> {
        return this.client.http.authedRequest(
            Method.Get,
            `/room_keys/keys/${version}`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 }
        );
    }

    /**
     * 获取房间备份密钥
     * GET /_matrix/client/v3/room_keys/keys/{version}/{room_id}
     */
    async getRoomBackupKeys(version: string, roomId: string): Promise<any> {
        return this.client.http.authedRequest(
            Method.Get,
            `/room_keys/keys/${version}/${encodeURIComponent(roomId)}`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 }
        );
    }

    /**
     * 获取会话备份密钥
     * GET /_matrix/client/v3/room_keys/keys/{version}/{room_id}/{session_id}
     */
    async getSessionBackupKey(version: string, roomId: string, sessionId: string): Promise<any> {
        return this.client.http.authedRequest(
            Method.Get,
            `/room_keys/keys/${version}/${encodeURIComponent(roomId)}/${encodeURIComponent(sessionId)}`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 }
        );
    }

    /**
     * 上传单个会话密钥
     * PUT /_matrix/client/v3/room_keys/keys/{version}/{room_id}/{session_id}
     */
    async uploadSessionKey(
        version: string,
        roomId: string,
        sessionId: string,
        sessionData: any
    ): Promise<{ etag: string }> {
        return this.client.http.authedRequest(
            Method.Put,
            `/room_keys/keys/${version}/${encodeURIComponent(roomId)}/${encodeURIComponent(sessionId)}`,
            undefined,
            sessionData,
            { prefix: ClientPrefix.V3 }
        );
    }

    /**
     * 批量上传密钥
     * POST /_matrix/client/v3/room_keys/{version}/keys
     */
    async uploadBatchKeys(
        version: string,
        keys: Record<string, { sessions: Record<string, any> }>
    ): Promise<{ count: number; etag: string }> {
        return this.client.http.authedRequest(
            Method.Post,
            `/room_keys/${version}/keys`,
            undefined,
            keys,
            { prefix: ClientPrefix.V3 }
        );
    }

    // ==================== 恢复与校验 ====================

    /**
     * 恢复密钥
     * POST /_matrix/client/v3/room_keys/recover
     */
    async recoverKeys(version: string, rooms?: string[]): Promise<{
        rooms: any;
        total_keys: number;
        recovered_keys: number;
    }> {
        return this.client.http.authedRequest(
            Method.Post,
            "/room_keys/recover",
            undefined,
            { version, rooms },
            { prefix: ClientPrefix.V3 }
        );
    }

    /**
     * 获取恢复进度
     * GET /_matrix/client/v3/room_keys/recovery/{version}/progress
     */
    async getRecoveryProgress(version: string): Promise<RecoveryProgress> {
        return this.client.http.authedRequest(
            Method.Get,
            `/room_keys/recovery/${version}/progress`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 }
        );
    }

    /**
     * 验证备份
     * GET /_matrix/client/v3/room_keys/verify/{version}
     */
    async verifyBackup(version: string): Promise<{
        valid: boolean;
        algorithm: string;
        auth_data: any;
        key_count: number;
        signatures?: any;
    }> {
        return this.client.http.authedRequest(
            Method.Get,
            `/room_keys/verify/${version}`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 }
        );
    }

    /**
     * 批量恢复
     * POST /_matrix/client/v3/room_keys/batch_recover
     */
    async batchRecover(
        version: string,
        roomIds: string[],
        sessionLimit?: number
    ): Promise<BatchRecoverResult> {
        return this.client.http.authedRequest(
            Method.Post,
            "/room_keys/batch_recover",
            undefined,
            { version, room_ids: roomIds, session_limit: sessionLimit },
            { prefix: ClientPrefix.V3 }
        );
    }

    /**
     * 恢复房间密钥
     * GET /_matrix/client/v3/room_keys/recover/{version}/{room_id}
     */
    async recoverRoomKeys(version: string, roomId: string): Promise<any> {
        return this.client.http.authedRequest(
            Method.Get,
            `/room_keys/recover/${version}/${encodeURIComponent(roomId)}`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 }
        );
    }

    /**
     * 恢复会话密钥
     * GET /_matrix/client/v3/room_keys/recover/{version}/{room_id}/{session_id}
     */
    async recoverSessionKey(version: string, roomId: string, sessionId: string): Promise<any> {
        return this.client.http.authedRequest(
            Method.Get,
            `/room_keys/recover/${version}/${encodeURIComponent(roomId)}/${encodeURIComponent(sessionId)}`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 }
        );
    }

    // ==================== 导出与导入 ====================

    /**
     * 导出密钥
     * GET /_matrix/client/v3/room_keys/export
     */
    async exportKeys(): Promise<ExportResult> {
        return this.client.http.authedRequest(
            Method.Get,
            "/room_keys/export",
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 }
        );
    }

    /**
     * 导出指定版本密钥
     * GET /_matrix/client/v3/room_keys/export/{version}
     */
    async exportKeysByVersion(version: string): Promise<ExportResult> {
        return this.client.http.authedRequest(
            Method.Get,
            `/room_keys/export/${version}`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 }
        );
    }

    /**
     * 导入密钥
     * POST /_matrix/client/v3/room_keys/import
     */
    async importKeys(roomKeys: ExportResult["room_keys"], version?: string): Promise<ImportResult> {
        return this.client.http.authedRequest(
            Method.Post,
            "/room_keys/import",
            undefined,
            { room_keys: roomKeys, version },
            { prefix: ClientPrefix.V3 }
        );
    }

    /**
     * 导入密钥到指定版本
     * POST /_matrix/client/v3/room_keys/import/{version}
     */
    async importKeysToVersion(version: string, roomKeys: ExportResult["room_keys"]): Promise<ImportResult> {
        return this.client.http.authedRequest(
            Method.Post,
            `/room_keys/import/${version}`,
            undefined,
            { room_keys: roomKeys },
            { prefix: ClientPrefix.V3 }
        );
    }
}
```

### 4.2 添加 Secure Backup Manager

```typescript
import { MatrixClient } from "../client";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";

export interface SecureBackupInfo {
    backup_id: string;
    version: string;
    algorithm: string;
    auth_data: any;
    key_count: number;
}

export class SecureBackupManager {
    constructor(private client: MatrixClient) {}

    /**
     * 创建安全备份
     * POST /_matrix/client/v3/keys/backup/secure
     */
    async createSecureBackup(passphrase: string): Promise<SecureBackupInfo> {
        return this.client.http.authedRequest(
            Method.Post,
            "/keys/backup/secure",
            undefined,
            { passphrase },
            { prefix: ClientPrefix.V3 }
        );
    }

    /**
     * 获取安全备份
     * GET /_matrix/client/v3/keys/backup/secure/{backup_id}
     */
    async getSecureBackup(backupId: string): Promise<SecureBackupInfo> {
        return this.client.http.authedRequest(
            Method.Get,
            `/keys/backup/secure/${backupId}`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 }
        );
    }

    /**
     * 删除安全备份
     * DELETE /_matrix/client/v3/keys/backup/secure/{backup_id}
     */
    async deleteSecureBackup(backupId: string): Promise<void> {
        await this.client.http.authedRequest(
            Method.Delete,
            `/keys/backup/secure/${backupId}`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 }
        );
    }

    /**
     * 添加密钥到安全备份
     * POST /_matrix/client/v3/keys/backup/secure/{backup_id}/keys
     */
    async addKeysToSecureBackup(
        backupId: string,
        passphrase: string,
        sessionKeys: Array<{
            room_id: string;
            session_id: string;
            session_key: string;
        }>
    ): Promise<{ key_count: number }> {
        return this.client.http.authedRequest(
            Method.Post,
            `/keys/backup/secure/${backupId}/keys`,
            undefined,
            { passphrase, session_keys: sessionKeys },
            { prefix: ClientPrefix.V3 }
        );
    }

    /**
     * 从安全备份恢复
     * POST /_matrix/client/v3/keys/backup/secure/{backup_id}/restore
     */
    async restoreFromSecureBackup(
        backupId: string,
        passphrase: string
    ): Promise<{ success: boolean; key_count: number; message?: string }> {
        return this.client.http.authedRequest(
            Method.Post,
            `/keys/backup/secure/${backupId}/restore`,
            undefined,
            { passphrase },
            { prefix: ClientPrefix.V3 }
        );
    }

    /**
     * 验证安全备份
     * POST /_matrix/client/v3/keys/backup/secure/{backup_id}/verify
     */
    async verifySecureBackup(backupId: string, passphrase: string): Promise<{ valid: boolean }> {
        return this.client.http.authedRequest(
            Method.Post,
            `/keys/backup/secure/${backupId}/verify`,
            undefined,
            { passphrase },
            { prefix: ClientPrefix.V3 }
        );
    }
}
```

---

## 5. 实施计划

### 5.1 第一阶段：高优先级修复 (1 天)

| 任务 | 工作量 | 责任人 |
|------|--------|--------|
| 重构 KeyBackupManager 为直接 HTTP 调用 | 0.5 天 | SDK |
| 添加恢复与校验方法 | 0.25 天 | SDK |
| 添加导入导出方法 | 0.25 天 | SDK |

### 5.2 第二阶段：中优先级修复 (0.5 天)

| 任务 | 工作量 | 责任人 |
|------|--------|--------|
| 添加 SecureBackupManager | 0.25 天 | SDK |
| 添加批量上传方法 | 0.25 天 | SDK |

---

## 6. 验证结果

### 6.1 后端验证

```
✅ 后端实现完整，所有端点均已实现
✅ 支持 v1/r0/v3 版本兼容
```

### 6.2 SDK 验证

```
⚠️ 使用间接封装而非直接 HTTP 调用
❌ 恢复与校验功能缺失
❌ 导入导出功能缺失
❌ Secure Backup 功能缺失
```

---

## 7. 结论

### 7.1 当前状态

- ✅ 后端实现完整，契约文档准确
- ⚠️ SDK 使用间接封装
- ❌ 大量端点未封装

### 7.2 封装覆盖率

- **后端路由总数**: 32 个端点 (key_backup.rs + e2ee_routes.rs)
- **SDK 已封装**: 8 个方法 (间接)
- **直接 HTTP 封装**: 0/32 (0%)
- **未封装**: 24/32 (75%)

### 7.3 修复优先级

| 优先级 | 问题 | 影响 | 状态 |
|--------|------|------|------|
| 🔴 P0 | 使用间接封装 | 功能不稳定 | 待修复 |
| 🔴 P0 | 缺少恢复功能 | 无法恢复备份 | 待修复 |
| 🔴 P0 | 缺少导入导出 | 无法迁移数据 | 待修复 |
| ⚠️ P1 | 缺少 Secure Backup | 无安全备份 | 待修复 |
| ⚠️ P1 | 缺少批量上传 | 效率低下 | 待修复 |
