# Key Backup 模块审查总结

> 说明: 本文件保留 2026-04-15 的阶段性审查快照。当前契约结论请以 `key-backup.md`、`README.md` 与 `CHANGELOG.md` 为准。

**审查日期**: 2026-04-15  
**审查状态**: ✅ 已完成审查

---

## 执行摘要

Key Backup 模块提供端到端加密密钥的备份和恢复功能，是 E2EE 功能的重要补充。已完成后端代码审查，现有契约文档已经非常完整和详细。

### 审查结果

**核心文件**:

- `synapse-rust/src/web/routes/key_backup.rs` (500+ 行)
- `synapse-rust/src/services/backup_service.rs` - 备份服务

**关键发现**:

1. **接口实现**（32 个端点）:

    **备份版本管理（5 个）**:
    - ✅ `GET /room_keys/version` - 获取所有备份版本
    - ✅ `POST /room_keys/version` - 创建备份版本
    - ✅ `GET /room_keys/version/{version}` - 获取备份版本
    - ✅ `PUT /room_keys/version/{version}` - 更新备份版本
    - ✅ `DELETE /room_keys/version/{version}` - 删除备份版本

    **备份密钥读写（11 个）**:
    - ✅ `GET /room_keys/keys` - 获取所有备份密钥
    - ✅ `PUT /room_keys/keys` - 上传密钥到最新版本
    - ✅ `GET /room_keys/keys/{version}` - 获取指定版本的密钥
    - ✅ `PUT /room_keys/keys/{version}` - 上传密钥到指定版本
    - ✅ `GET /room_keys/keys/{version}/{room_id}` - 获取房间备份密钥
    - ✅ `GET /room_keys/keys/{version}/{room_id}/{session_id}` - 获取会话密钥
    - ✅ `PUT /room_keys/keys/{version}/{room_id}/{session_id}` - 上传会话密钥
    - ✅ `GET /room_keys/{version}` - 兼容别名
    - ✅ `PUT /room_keys/{version}` - 兼容别名
    - ✅ `POST /room_keys/{version}/keys` - 批量上传密钥
    - ✅ `GET /room_keys/{version}/keys/{room_id}` - 兼容别名

    **恢复与校验（6 个）**:
    - ✅ `POST /room_keys/recover` - 恢复密钥
    - ✅ `GET /room_keys/recovery/{version}/progress` - 获取恢复进度
    - ✅ `GET /room_keys/verify/{version}` - 验证备份
    - ✅ `POST /room_keys/batch_recover` - 批量恢复
    - ✅ `GET /room_keys/recover/{version}/{room_id}` - 恢复房间密钥
    - ✅ `GET /room_keys/recover/{version}/{room_id}/{session_id}` - 恢复会话密钥

    **导出与导入（4 个）**:
    - ✅ `GET /room_keys/export` - 导出密钥
    - ✅ `GET /room_keys/export/{version}` - 导出指定版本
    - ✅ `POST /room_keys/import` - 导入密钥
    - ✅ `POST /room_keys/import/{version}` - 导入到指定版本

    **Secure Backup（6 个，在 e2ee_routes.rs）**:
    - ✅ `POST /keys/backup/secure` - 创建安全备份
    - ✅ `GET /keys/backup/secure/{backup_id}` - 获取安全备份
    - ✅ `DELETE /keys/backup/secure/{backup_id}` - 删除安全备份
    - ✅ `POST /keys/backup/secure/{backup_id}/keys` - 添加密钥
    - ✅ `POST /keys/backup/secure/{backup_id}/restore` - 恢复
    - ✅ `POST /keys/backup/secure/{backup_id}/verify` - 验证

2. **核心特性**:
    - 备份版本管理（创建、查询、更新、删除）
    - 密钥备份（全量、增量、单会话）
    - 密钥恢复（全量、批量、单房间、单会话）
    - 备份验证
    - 密钥导出/导入
    - 安全备份（加密备份）

3. **数据约束**:
    - version: 字符串，自动生成
    - algorithm: 默认 "m.megolm.v1.aes-sha2"，最大 255 字符
    - room_id: 1-255 字符
    - session_id: 字符串
    - first_message_index: 整数
    - forwarded_count: 整数
    - is_verified: 布尔值

4. **SDK 封装状态**:
    - ✅ 28 个方法精确对齐后端
    - ✅ KeyBackupManager 完整实现
    - ✅ SecureBackupManager 完整实现
    - ⚠️ 4 个后端兼容别名未单独封装（不影响功能）

---

## 核心接口总结

### 1. 备份版本管理

```http
# 创建备份版本
POST /_matrix/client/v3/room_keys/version
Body: { "algorithm": "m.megolm.v1.aes-sha2", "auth_data": {...} }
Response: { "version": "1" }

# 获取所有版本
GET /_matrix/client/v3/room_keys/version
Response: { "versions": [{ "version", "algorithm", "auth_data" }] }

# 获取指定版本
GET /_matrix/client/v3/room_keys/version/{version}
Response: { "version", "algorithm", "auth_data" }

# 更新版本
PUT /_matrix/client/v3/room_keys/version/{version}
Body: { "auth_data": {...} }
Response: { "version" }

# 删除版本
DELETE /_matrix/client/v3/room_keys/version/{version}
Response: { "deleted": true, "version" }
```

### 2. 密钥备份

```http
# 上传密钥到最新版本
PUT /_matrix/client/v3/room_keys/keys
Body: { "room_id", "sessions": [...] }
Response: { "count", "etag" }

# 上传密钥到指定版本
PUT /_matrix/client/v3/room_keys/keys/{version}
Body: { "room_id", "sessions": [...] }
Response: { "count", "etag" }

# 上传单个会话密钥
PUT /_matrix/client/v3/room_keys/keys/{version}/{room_id}/{session_id}
Body: { "first_message_index", "forwarded_count", "is_verified", "session_data" }
Response: { "count", "etag" }

# 批量上传
POST /_matrix/client/v3/room_keys/{version}/keys
Body: { "!room1": { "sessions": [...] }, "!room2": { "sessions": [...] } }
Response: { "count", "etag" }
```

### 3. 密钥恢复

```http
# 恢复密钥
POST /_matrix/client/v3/room_keys/recover
Body: { "version", "recovery_key" }
Response: { "total_sessions", "recovered_sessions" }

# 获取恢复进度
GET /_matrix/client/v3/room_keys/recovery/{version}/progress
Response: { "user_id", "version", "total_keys", "recovered_keys", "status" }

# 批量恢复
POST /_matrix/client/v3/room_keys/batch_recover
Body: { "version", "recovery_key", "limit" }
Response: { "rooms", "total_sessions", "has_more", "next_batch" }

# 恢复房间密钥
GET /_matrix/client/v3/room_keys/recover/{version}/{room_id}
Response: { "sessions": {...} }

# 恢复单个会话
GET /_matrix/client/v3/room_keys/recover/{version}/{room_id}/{session_id}
Response: { "session_data" }
```

### 4. 验证、导出、导入

```http
# 验证备份
GET /_matrix/client/v3/room_keys/verify/{version}
Response: { "valid", "algorithm", "auth_data", "key_count" }

# 导出密钥
GET /_matrix/client/v3/room_keys/export
Response: { "room_keys": [...], "version" }

# 导出指定版本
GET /_matrix/client/v3/room_keys/export/{version}
Response: { "room_keys": [...], "version" }

# 导入密钥
POST /_matrix/client/v3/room_keys/import
Body: { "room_keys": [...] }
Response: { "count", "failed", "total" }

# 导入到指定版本
POST /_matrix/client/v3/room_keys/import/{version}
Body: { "room_keys": [...] }
Response: { "count", "failed", "total" }
```

---

## 数据约束

| 字段                | 约束          | 说明                        |
| ------------------- | ------------- | --------------------------- |
| version             | 字符串        | 自动生成，通常为数字        |
| algorithm           | 最大 255 字符 | 默认 "m.megolm.v1.aes-sha2" |
| room_id             | 1-255 字符    | Matrix 房间 ID              |
| session_id          | 字符串        | Megolm 会话 ID              |
| first_message_index | 整数          | 第一条消息索引              |
| forwarded_count     | 整数          | 转发次数                    |
| is_verified         | 布尔值        | 是否已验证                  |
| session_data        | 对象          | 加密的会话数据              |

---

## 错误码

| 错误码          | HTTP 状态码 | 场景                 |
| --------------- | ----------- | -------------------- |
| M_BAD_JSON      | 400         | 请求体格式错误       |
| M_INVALID_PARAM | 400         | 参数验证失败         |
| M_UNKNOWN_TOKEN | 401         | Token 无效           |
| M_NOT_FOUND     | 404         | 备份版本或密钥不存在 |

---

## 核心概念

### 1. 备份版本

- 每个用户可以有多个备份版本
- 版本号自动生成（通常为递增数字）
- 每个版本有独立的算法和认证数据

### 2. 会话密钥备份

- 备份 Megolm 会话密钥
- 包含会话数据、消息索引、转发次数等
- 按房间和会话 ID 组织

### 3. 恢复机制

- 支持全量恢复
- 支持批量恢复（分页）
- 支持单房间/单会话恢复
- 需要恢复密钥（recovery_key）

### 4. 安全备份

- 使用密码或恢复密钥加密
- 存储在服务器端
- 支持跨设备恢复

---

## 数据库表

### e2e_room_keys_backup 表

```sql
CREATE TABLE e2e_room_keys_backup (
    user_id TEXT NOT NULL,
    version TEXT NOT NULL,
    room_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    first_message_index BIGINT NOT NULL,
    forwarded_count BIGINT NOT NULL,
    is_verified BOOLEAN NOT NULL,
    session_data JSONB NOT NULL,
    created_ts BIGINT NOT NULL,
    PRIMARY KEY (user_id, version, room_id, session_id)
);
```

### e2e_room_keys_backup_version 表

```sql
CREATE TABLE e2e_room_keys_backup_version (
    user_id TEXT NOT NULL,
    version TEXT NOT NULL,
    algorithm TEXT NOT NULL,
    auth_data JSONB,
    etag TEXT,
    created_ts BIGINT NOT NULL,
    PRIMARY KEY (user_id, version)
);
```

---

## 质量评价

**评级**: ⭐⭐⭐⭐⭐ **优秀**

**理由**:

- ✅ 现有文档非常完整和详细
- ✅ 覆盖了所有 32 个端点
- ✅ SDK 封装完整（28 个方法）
- ✅ 包含详细的类型定义
- ✅ 已完成审计和修复（2026-04-04）
- ✅ 后端实现完整

---

## 封装覆盖率

- **后端路由总数**: 32 个端点
- **精确对齐的 SDK 封装**: 28 个方法
- **后端兼容别名未单独封装**: 4 个端点（不影响功能）
- **封装覆盖率**: 87.5% (28/32)
- **功能覆盖率**: 100%（所有功能都可通过 SDK 访问）

---

## 建议

由于 Key Backup 模块的文档已经非常完整（包含详细的审计报告），建议：

1. **保持现有文档**: 文档质量极高，无需大幅修改
2. **补充使用示例**: 添加更多实际使用场景
3. **补充最佳实践**: 添加备份和恢复的最佳实践指南
4. **补充安全建议**: 添加密钥管理的安全建议

---

## 注意事项

1. **备份版本管理**:
    - 版本号自动生成
    - 删除版本会删除所有相关密钥

2. **密钥备份**:
    - 支持增量备份
    - 支持批量上传
    - 自动生成 etag

3. **密钥恢复**:
    - 需要恢复密钥
    - 支持分页恢复
    - 可以查询恢复进度

4. **安全备份**:
    - 使用密码或恢复密钥加密
    - 独立于普通备份
    - 更高的安全性

5. **兼容性**:
    - 支持 r0/v1/v3 前缀
    - 提供兼容别名路径
    - SDK 封装主要路径

---

**审查人**: SDK 开发工程师  
**状态**: ✅ 完成  
**建议**: 现有文档质量极高，已完成审计和修复，无需大幅修改
