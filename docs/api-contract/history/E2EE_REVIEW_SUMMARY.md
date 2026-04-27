# E2EE 模块审查总结

> 说明: 本文件保留 2026-04-15 的阶段性审查快照。当前契约结论请以 `e2ee.md`、`README.md` 与 `CHANGELOG.md` 为准。


**审查日期**: 2026-04-15  
**审查状态**: ✅ 已完成基础审查

---

## 执行摘要

E2EE（端到端加密）模块是 Matrix 协议的核心安全功能，负责设备密钥管理、一次性密钥、跨设备签名、房间密钥分发等。已完成后端代码审查，现有契约文档已经比较完整。

### 审查结果

**核心文件**: 
- `synapse-rust/src/web/routes/e2ee_routes.rs` (600+ 行)
- `synapse-rust/src/e2ee/device_keys.rs` - 设备密钥服务
- `synapse-rust/src/e2ee/cross_signing.rs` - 跨设备签名服务

**关键发现**:

1. **接口实现**（15+ 个核心接口）:
   - ✅ `POST /keys/upload` - 上传设备密钥和一次性密钥
   - ✅ `POST /keys/query` - 查询设备密钥
   - ✅ `POST /keys/claim` - 声明一次性密钥
   - ✅ `GET /keys/changes` - 获取密钥变化
   - ✅ `POST /keys/device_list/update` - 更新设备列表
   - ✅ `POST /keys/signatures/upload` - 上传签名
   - ✅ `POST /keys/device_signing/upload` - 上传设备签名密钥
   - ✅ `POST /room_keys/request` - 创建房间密钥请求
   - ✅ `GET /room_keys/request` - 获取房间密钥请求
   - ✅ `DELETE /room_keys/request/{request_id}` - 删除密钥请求
   - ✅ `GET /rooms/{room_id}/keys/distribution` - 获取房间密钥分发
   - ✅ `PUT /sendToDevice/{event_type}/{txn_id}` - 发送设备消息
   - ✅ `POST /device_verification/*` - 设备验证（v3）
   - ✅ `GET /device_trust*` - 设备信任（v3）
   - ✅ `POST /keys/backup/secure*` - 安全备份（v3）

2. **核心特性**:
   - 设备密钥管理（Curve25519 + Ed25519）
   - 一次性密钥（Signed Curve25519）
   - 跨设备签名（Master Key, Self-Signing Key, User-Signing Key）
   - 房间密钥分发（Megolm）
   - To-Device 消息
   - 设备列表变更追踪
   - 安全备份

3. **数据约束**:
   - device_id: 必需（除 query/claim）
   - algorithms: 数组，通常包含 "m.olm.v1.curve25519-aes-sha2"
   - keys: 对象，键格式为 "algorithm:device_id"
   - signatures: 嵌套对象，格式为 user_id -> key_id -> signature

4. **安全特性**:
   - 设备密钥签名验证
   - 跨设备签名链
   - 房间成员验证（房间密钥分发）
   - 设备列表隐私保护（只返回有共享房间的用户）

---

## 核心接口总结

### 1. 设备密钥管理

```http
# 上传密钥
POST /_matrix/client/v3/keys/upload
Body: {
  "device_keys": { "user_id", "device_id", "algorithms", "keys", "signatures" },
  "one_time_keys": { "signed_curve25519:AAAAAA": { "key", "signatures" } }
}
Response: { "one_time_key_counts": { "signed_curve25519": 50 } }

# 查询密钥
POST /_matrix/client/v3/keys/query
Body: { "device_keys": { "@user:server": ["device1", "device2"] } }
Response: { "device_keys": {...}, "failures": {} }

# 声明一次性密钥
POST /_matrix/client/v3/keys/claim
Body: { "one_time_keys": { "@user:server": { "device": "algorithm" } } }
Response: { "one_time_keys": {...}, "failures": {} }

# 获取密钥变化
GET /_matrix/client/v3/keys/changes?from=token&to=token
Response: { "changed": [...], "left": [...] }
```

### 2. 跨设备签名

```http
# 上传签名
POST /_matrix/client/v3/keys/signatures/upload
Body: { "@user:server": { "device": { "user_id", "device_id", "keys", "signatures" } } }

# 上传设备签名密钥
POST /_matrix/client/v3/keys/device_signing/upload
Body: { "master_key": {...}, "self_signing_key": {...}, "user_signing_key": {...} }
```

### 3. 房间密钥

```http
# 获取房间密钥分发
GET /_matrix/client/v3/rooms/{room_id}/keys/distribution
Response: { "room_id", "algorithm", "session_id", "session_key" }

# 创建密钥请求
POST /_matrix/client/v3/room_keys/request
Body: { "room_id", "session_id", "algorithm", "request_type" }
Response: { "request_id" }

# 获取密钥请求
GET /_matrix/client/v3/room_keys/request
Response: { "requests": [...] }

# 删除密钥请求
DELETE /_matrix/client/v3/room_keys/request/{request_id}
```

### 4. To-Device 消息

```http
PUT /_matrix/client/v3/sendToDevice/{event_type}/{txn_id}
Body: {
  "messages": {
    "@user:server": {
      "device": { "algorithm", "room_id", "session_id", "session_key" }
    }
  }
}
```

---

## 数据约束

| 字段 | 约束 | 说明 |
|------|------|------|
| device_id | 必需（大部分接口） | 16 字符 |
| algorithms | 数组 | 支持的加密算法 |
| keys | 对象 | 格式: "algorithm:device_id" |
| signatures | 嵌套对象 | user_id -> key_id -> signature |
| one_time_keys | 对象 | 格式: "algorithm:key_id" |

---

## 错误码

| 错误码 | HTTP 状态码 | 场景 |
|--------|------------|------|
| M_BAD_JSON | 400 | 请求体格式错误 |
| M_INVALID_SIGNATURE | 400 | 签名无效 |
| M_UNKNOWN_TOKEN | 401 | Token 无效 |
| M_FORBIDDEN | 403 | 无权访问房间密钥 |
| M_NOT_FOUND | 404 | 密钥或会话不存在 |

---

## 核心概念

### 1. 设备密钥

每个设备有两个密钥对：
- **Identity Key** (Curve25519): 用于建立 Olm 会话
- **Signing Key** (Ed25519): 用于签名消息

### 2. 一次性密钥

- 用于建立新的 Olm 会话
- 每个密钥只使用一次
- 格式: `signed_curve25519:key_id`
- 需要用设备的 Ed25519 密钥签名

### 3. 跨设备签名

三层密钥结构：
- **Master Key**: 用户的根密钥
- **Self-Signing Key**: 签名自己的设备
- **User-Signing Key**: 签名其他用户的 Master Key

### 4. Megolm 会话

- 用于房间加密
- 一个会话密钥可以加密多条消息
- 通过 To-Device 消息分发给房间成员

---

## 安全特性

### 1. 设备验证

- 通过签名链验证设备身份
- 支持 SAS（Short Authentication String）验证
- 支持 QR 码验证

### 2. 隐私保护

- 设备列表变更只返回有共享房间的用户
- 房间密钥分发需要房间成员身份

### 3. 密钥轮换

- 一次性密钥用完后需要重新上传
- Megolm 会话定期轮换

---

## 数据库表

### e2e_device_keys 表

```sql
CREATE TABLE e2e_device_keys (
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    algorithm TEXT NOT NULL,
    key_json JSONB NOT NULL,
    created_ts BIGINT NOT NULL,
    PRIMARY KEY (user_id, device_id)
);
```

### e2e_one_time_keys 表

```sql
CREATE TABLE e2e_one_time_keys (
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    algorithm TEXT NOT NULL,
    key_id TEXT NOT NULL,
    key_json JSONB NOT NULL,
    created_ts BIGINT NOT NULL,
    PRIMARY KEY (user_id, device_id, algorithm, key_id)
);
```

### e2e_cross_signing_keys 表

```sql
CREATE TABLE e2e_cross_signing_keys (
    user_id TEXT NOT NULL,
    key_type TEXT NOT NULL,  -- 'master', 'self_signing', 'user_signing'
    key_json JSONB NOT NULL,
    created_ts BIGINT NOT NULL,
    PRIMARY KEY (user_id, key_type)
);
```

---

## 质量评价

**评级**: ⭐⭐⭐⭐⭐ **优秀**

**理由**:
- ✅ 现有文档已经比较完整
- ✅ 覆盖了核心 E2EE 功能
- ✅ 包含详细的类型定义
- ✅ 提供了使用示例
- ✅ 后端实现完整

---

## 建议

由于 E2EE 模块非常复杂且现有文档已经比较完整，建议：

1. **保持现有文档**: 基础文档质量高
2. **补充安全特性**: 添加更多安全机制说明
3. **补充数据库表**: 添加表结构定义
4. **补充错误处理**: 完善错误码映射
5. **补充验证流程**: 添加设备验证流程说明

---

## 注意事项

1. **设备 ID 必需**: 大部分接口需要 device_id
2. **签名验证**: 所有密钥都需要正确签名
3. **房间成员验证**: 房间密钥分发需要成员身份
4. **隐私保护**: 设备列表变更有隐私过滤
5. **密钥格式**: 严格的密钥格式要求
6. **一次性密钥管理**: 需要定期补充
7. **跨设备签名链**: 需要正确的签名链

---

**审查人**: SDK 开发工程师  
**状态**: ✅ 完成  
**建议**: 现有文档质量高，仅需小幅补充