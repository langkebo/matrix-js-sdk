# E2EE (End-to-End Encryption) API 契约

> 版本: v1.0.0
> 更新日期: 2026-04-05
> 对应 SDK 模块: `src/device-keys/index.ts`, `src/device-trust/index.ts`, `src/secure-backup/index.ts`

---

## 概述

E2EE API 提供端到端加密功能，包括设备密钥管理、一次性密钥、跨设备签名、安全备份等。

---

## API 端点

### 设备密钥管理

#### 上传设备密钥

```
POST /_matrix/client/v3/keys/upload
```

**请求体:**

```json
{
    "device_keys": {
        "user_id": "@user:example.com",
        "device_id": "DEVICEID",
        "algorithms": ["m.olm.v1.curve25519-aes-sha2", "m.megolm.v1.aes-sha2"],
        "keys": {
            "curve25519:DEVICEID": "key_base64",
            "ed25519:DEVICEID": "key_base64"
        },
        "signatures": {
            "@user:example.com": {
                "ed25519:DEVICEID": "signature_base64"
            }
        }
    },
    "one_time_keys": {
        "signed_curve25519:AAAAAA": {
            "key": "key_base64",
            "signatures": {}
        }
    }
}
```

**响应:**

```json
{
    "one_time_key_counts": {
        "signed_curve25519": 50,
        "curve25519": 0
    }
}
```

**SDK 方法:** `DeviceKeysManager.uploadKeys()`

---

#### 查询设备密钥

```
POST /_matrix/client/v3/keys/query
```

**请求体:**

```json
{
    "device_keys": {
        "@user1:example.com": ["DEVICEID1", "DEVICEID2"],
        "@user2:example.com": []
    },
    "token": "stream_token"
}
```

**响应:**

```json
{
    "device_keys": {
        "@user1:example.com": {
            "DEVICEID1": {
                "user_id": "@user1:example.com",
                "device_id": "DEVICEID1",
                "algorithms": [],
                "keys": {},
                "signatures": {}
            }
        }
    },
    "failures": {}
}
```

**SDK 方法:** `DeviceKeysManager.queryKeys()`

---

#### 声明一次性密钥

```
POST /_matrix/client/v3/keys/claim
```

**请求体:**

```json
{
    "one_time_keys": {
        "@user:example.com": {
            "DEVICEID": "signed_curve25519:AAAAAA"
        }
    }
}
```

**响应:**

```json
{
    "one_time_keys": {
        "@user:example.com": {
            "DEVICEID": {
                "signed_curve25519:AAAAAA": {
                    "key": "key_base64",
                    "signatures": {}
                }
            }
        }
    },
    "failures": {}
}
```

**SDK 方法:** `DeviceKeysManager.claimKeys()`

---

#### 获取密钥变化

```
GET /_matrix/client/v3/keys/changes?from=token&to=token
```

**响应:**

```json
{
    "changed": ["@user1:example.com", "@user2:example.com"],
    "left": ["@user3:example.com"]
}
```

**SDK 方法:** `DeviceKeysManager.getKeyChanges()`

---

### 设备签名

#### 上传签名

```
POST /_matrix/client/v3/keys/signatures/upload
```

**请求体:**

```json
{
    "@user:example.com": {
        "DEVICEID": {
            "user_id": "@user:example.com",
            "device_id": "DEVICEID",
            "keys": {},
            "signatures": {}
        }
    }
}
```

**SDK 方法:** `DeviceKeysManager.uploadSignatures()`

---

#### 上传设备签名密钥

```
POST /_matrix/client/v3/keys/device_signing/upload
```

**请求体:**

```json
{
    "master_key": {},
    "self_signing_key": {},
    "user_signing_key": {}
}
```

**SDK 方法:** `DeviceKeysManager.uploadDeviceSigning()`

---

### 房间密钥请求

#### 创建密钥请求

```
POST /_matrix/client/v3/room_keys/request
```

**请求体:**

```json
{
    "room_id": "!room:example.com",
    "session_id": "session_id",
    "algorithm": "m.megolm.v1.aes-sha2",
    "request_type": "request"
}
```

**SDK 方法:** `DeviceKeysManager.createRoomKeyRequest()`

---

#### 获取密钥请求

```
GET /_matrix/client/v3/room_keys/request
```

**响应:**

```json
{
    "requests": [
        {
            "request_id": "request_id",
            "user_id": "@user:example.com",
            "device_id": "DEVICEID",
            "room_id": "!room:example.com",
            "session_id": "session_id",
            "algorithm": "m.megolm.v1.aes-sha2",
            "status": "pending"
        }
    ]
}
```

**SDK 方法:** `DeviceKeysManager.getRoomKeyRequests()`

---

#### 删除密钥请求

```
DELETE /_matrix/client/v3/room_keys/request/{request_id}
```

**SDK 方法:** `DeviceKeysManager.deleteRoomKeyRequest()`

---

### 设备消息

#### 发送设备消息

```
PUT /_matrix/client/v3/sendToDevice/{event_type}/{txn_id}
```

**请求体:**

```json
{
    "messages": {
        "@user1:example.com": {
            "DEVICEID1": {
                "algorithm": "m.megolm.v1.aes-sha2",
                "room_id": "!room:example.com",
                "session_id": "session_id",
                "session_key": "key_base64"
            }
        }
    }
}
```

**SDK 方法:** `DeviceKeysManager.sendToDevice()`

---

## 错误码

| 错误码              | HTTP 状态码 | 说明           |
| ------------------- | ----------- | -------------- |
| M_MISSING_TOKEN     | 401         | 缺少访问令牌   |
| M_UNKNOWN_TOKEN     | 401         | 无效的访问令牌 |
| M_NOT_FOUND         | 404         | 资源不存在     |
| M_INVALID_SIGNATURE | 400         | 签名无效       |

---

## 类型定义

```typescript
export interface DeviceKeys {
    user_id: string;
    device_id: string;
    algorithms: string[];
    keys: Record<string, string>;
    signatures: Record<string, Record<string, string>>;
    unsigned?: Record<string, unknown>;
}

export interface OneTimeKeys {
    [keyId: string]: {
        key: string;
        signatures?: Record<string, Record<string, string>>;
    };
}

export interface UploadKeysResponse {
    one_time_key_counts?: Record<string, number>;
}

export interface QueryKeysResponse {
    device_keys?: Record<string, Record<string, DeviceKeys>>;
    failures?: Record<string, Record<string, string>>;
}

export interface ClaimKeysResponse {
    one_time_keys?: Record<string, Record<string, Record<string, any>>>;
    failures?: Record<string, Record<string, string>>;
}

export interface KeyChangesResponse {
    changed?: string[];
    left?: string[];
}
```

---

## 使用示例

```typescript
const client = new MatrixClient({ baseUrl: "https://matrix.example.com" });
const deviceKeysManager = client.getDeviceKeysManager();

// 上传设备密钥
await deviceKeysManager.uploadKeys({
    deviceKeys: {
        user_id: "@user:example.com",
        device_id: "DEVICEID",
        algorithms: ["m.olm.v1.curve25519-aes-sha2", "m.megolm.v1.aes-sha2"],
        keys: {
            /* ... */
        },
        signatures: {
            /* ... */
        },
    },
    oneTimeKeys: {
        /* ... */
    },
});

// 查询其他用户的设备密钥
const keys = await deviceKeysManager.queryKeys({
    device_keys: {
        "@other:example.com": [],
    },
});

// 声明一次性密钥
const claimedKeys = await deviceKeysManager.claimKeys({
    one_time_keys: {
        "@other:example.com": {
            DEVICEID: "signed_curve25519:AAAAAA",
        },
    },
});
```
