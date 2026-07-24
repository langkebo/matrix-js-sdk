---
module: rendezvous
generated_from: docs/api-contract/generated/modules/rendezvous.json
generated_hash: sha256-7a23003b4651c3269829672892295a7e144097aee06c051cdef7954d8cd50945
ledger_schema: 1
last_reviewed: 2026-05-11
---

# Rendezvous API 契约 (二维码登录)

> 版本: v1.0.0
> 更新日期: 2026-05-11
> 对应 SDK 模块: `src/rendezvous/RendezvousManager.ts`
> 审查来源: `synapse-rust/src/web/routes/rendezvous.rs`

---

## 概述

Rendezvous API 提供 MSC4108 二维码登录功能，允许用户通过扫描二维码在新设备上登录，无需输入密码。

## 鉴权规则

- `POST /_matrix/client/v1/rendezvous` 允许匿名创建会话。
- 其余 `/{session_id}` 与 `/{session_id}/messages` 路由必须满足以下任一条件：
    - 请求头携带 `X-Matrix-Rendezvous-Key: <key>`，且值与创建会话返回的 `key` 一致。
    - 会话已在 `status = connected` 阶段绑定用户，且调用方就是该绑定用户。
- 将会话更新为 `connected` 时，除了有效的会话 key，还必须带有效的 Matrix 访问令牌以完成用户绑定。

---

## API 端点

### 创建 Rendezvous 会话

```
POST /_matrix/client/v1/rendezvous
```

**请求体:**

```json
{
    "intent": "login.start",
    "transport": "http.v1",
    "transport_data": {
        "algorithms": ["sha256"]
    },
    "expires_in_ms": 300000
}
```

**响应:**

```json
{
    "url": "matrix://rendezvous/example.com/session_id",
    "session_id": "session_id",
    "key": "base64_encoded_key"
}
```

**SDK 方法:** `RendezvousManager.createSession()`

---

### 获取 Rendezvous 会话

```
GET /_matrix/client/v1/rendezvous/{session_id}
```

**请求头:**

```http
X-Matrix-Rendezvous-Key: <session key>
```

或在会话已绑定用户后改为携带该用户自己的 `Authorization: Bearer <access_token>`。

**响应:**

```json
{
    "session_id": "session_id",
    "intent": "login.start",
    "transport": "http.v1",
    "transport_data": {},
    "status": "created",
    "created_ts": 1712345678000,
    "expires_at": 1712345978000
}
```

**SDK 方法:** `RendezvousManager.getSession()`

---

### 更新 Rendezvous 会话

```
PUT /_matrix/client/v1/rendezvous/{session_id}
```

**请求头:**

```http
X-Matrix-Rendezvous-Key: <session key>
Authorization: Bearer <access_token>
```

- 更新为 `connected` 时同时需要会话 key 和有效访问令牌。
- 更新为 `completed` 时，已绑定用户可仅凭自己的访问令牌访问；持有会话 key 的另一端也可继续完成流程。

**请求体:**

```json
{
    "status": "connected"
}
```

**响应:**

```json
{
    "session_id": "session_id",
    "status": "connected"
}
```

当请求将状态更新为 `completed` 且会话已绑定用户时，响应会额外包含：

```json
{
    "session_id": "session_id",
    "status": "completed",
    "login_finish": {
        "access_token": "access_token",
        "device_id": "DEVICEID",
        "user_id": "@user:example.com"
    }
}
```

**SDK 方法:** `RendezvousManager.updateSession()`

---

### 删除 Rendezvous 会话

```
DELETE /_matrix/client/v1/rendezvous/{session_id}
```

**请求头:**

```http
X-Matrix-Rendezvous-Key: <session key>
```

或在会话已绑定用户后改为携带绑定用户自己的 `Authorization: Bearer <access_token>`。

**响应:**

```json
{}
```

**SDK 方法:** `RendezvousManager.deleteSession()`

---

### 发送消息到 Rendezvous 会话

```
POST /_matrix/client/v1/rendezvous/{session_id}/messages
```

**请求头:**

```http
X-Matrix-Rendezvous-Key: <session key>
```

或在会话已绑定用户后改为携带绑定用户自己的 `Authorization: Bearer <access_token>`。

**请求体:**

```json
{
    "type": "m.login.start",
    "content": {
        "homeserver": "https://matrix.example.com",
        "user_id": "@user:example.com"
    }
}
```

**响应:**

```json
{
    "session_id": "session_id",
    "message_id": "message_id",
    "sent_ts": 1712345678000
}
```

**SDK 方法:** `RendezvousManager.sendMessage()`

---

### 获取 Rendezvous 会话的消息

```
GET /_matrix/client/v1/rendezvous/{session_id}/messages
```

**请求头:**

```http
X-Matrix-Rendezvous-Key: <session key>
```

或在会话已绑定用户后改为携带绑定用户自己的 `Authorization: Bearer <access_token>`。

**响应:**

```json
{
    "messages": [
        {
            "type": "m.login.start",
            "content": {
                "homeserver": "https://matrix.example.com",
                "user_id": "@user:example.com"
            }
        }
    ]
}
```

**SDK 方法:** `RendezvousManager.getMessages()`

---

## 会话状态流转

```
created → connected → completed
    ↓         ↓
  expired  cancelled
```

| 状态        | 说明                        |
| ----------- | --------------------------- |
| `created`   | 会话已创建，等待另一端连接  |
| `connected` | 双方已连接，正在交换信息    |
| `completed` | 登录完成，返回 access_token |
| `expired`   | 会话已过期                  |
| `cancelled` | 会话已取消                  |

---

## Intent 类型

| Intent              | 说明                   |
| ------------------- | ---------------------- |
| `login.start`       | 在新设备上启动登录流程 |
| `login.reciprocate` | 在已登录设备上确认登录 |

---

## Transport 类型

| Transport | 说明            |
| --------- | --------------- |
| `http.v1` | HTTP 轮询传输   |
| `http.v2` | HTTP 长轮询传输 |

---

## 错误码

| 错误码                 | HTTP 状态码 | 说明                              |
| ---------------------- | ----------- | --------------------------------- |
| M_MISSING_TOKEN        | 401         | 更新为 `connected` 时缺少访问令牌 |
| M_UNKNOWN_TOKEN        | 401         | 无效的访问令牌                    |
| M_UNAUTHORIZED         | 401         | 缺少或提供了错误的 rendezvous key |
| M_FORBIDDEN            | 403         | 已绑定会话被其他用户越权访问      |
| M_NOT_FOUND            | 404         | 会话不存在或已过期                |
| M_RENDEZVOUS_EXPIRED   | 410         | 会话已过期                        |
| M_RENDEZVOUS_CANCELLED | 410         | 会话已取消                        |

---

## SDK 对齐状态

- **总端点数**: 6
- **已封装**: 6
- **覆盖率**: 100%
- **路径绑定**: `src/rendezvous/RendezvousManager.ts` 现已绑定生成的 `RendezvousPathPattern`
- **验证状态**: `spec/unit/rendezvous-manager.spec.ts`

---

## 类型定义

```typescript
export type RendezvousSessionIntent = "login.start" | "login.reciprocate";

export type RendezvousSessionTransport = "http.v1" | "http.v2";

export type RendezvousSessionStatus = "created" | "connected" | "completed" | "expired" | "cancelled";

export interface RendezvousSession {
    session_id: string;
    intent: RendezvousSessionIntent;
    transport: RendezvousSessionTransport;
    transport_data?: Record<string, unknown>;
    status: RendezvousSessionStatus;
    created_ts: number;
    expires_at?: number;
    user_id?: string;
    device_id?: string;
    key?: string;
}

export interface CreateSessionResponse {
    url: string;
    session_id: string;
    key: string;
}

export interface UpdateSessionResponse {
    session_id: string;
    status: RendezvousSessionStatus;
    login_finish?: {
        access_token: string;
        device_id: string;
        user_id: string;
    };
}

export interface RendezvousMessage {
    type: string;
    content: Record<string, unknown>;
}

export interface SendMessageResponse {
    session_id: string;
    message_id: string;
    sent_ts: number;
}

export interface GetMessagesResponse {
    messages: RendezvousMessage[];
}
```

---

## 使用示例

### 新设备启动登录

```typescript
const client = new MatrixClient({ baseUrl: "https://matrix.example.com" });
const rendezvousManager = client.getRendezvousManager();

// 创建会话
const session = await rendezvousManager.createSession({
    intent: "login.start",
    transport: "http.v1",
    expires_in_ms: 300000,
});

// 生成二维码 (session.url)
console.log("Scan this QR code:", session.url);

// 轮询等待完成
const messages = await rendezvousManager.pollForMessages(session.session_id, {
    interval: 1000,
    maxAttempts: 60,
    sessionKey: session.key,
    onMessage: (messages) => {
        console.log("Received messages:", messages);
    },
});

// 完成登录
const loginResult = await rendezvousManager.completeSession(session.session_id, session.key);
if (loginResult) {
    console.log("Login successful!", loginResult.access_token);
}
```

### 已登录设备确认登录

```typescript
// 从二维码获取 session_id 和 session_key
const sessionId = "session_id_from_qr_code";
const sessionKey = "session_key_from_qr_code";

// 连接到会话
await rendezvousManager.connectToSession(sessionId, sessionKey);

// 发送确认消息
await rendezvousManager.sendMessage(
    sessionId,
    {
        type: "m.login.reciprocate",
        content: {
            user_id: "@user:example.com",
            device_id: "EXISTING_DEVICE",
        },
    },
    sessionKey,
);

// 完成会话
await rendezvousManager.updateSession(sessionId, "completed", sessionKey);
```

---

## 安全注意事项

1. **会话密钥**: `key` 字段包含用于加密通信的密钥，应妥善保管
2. **过期时间**: 建议设置较短的过期时间 (5分钟以内)
3. **一次性使用**: 每个会话只能使用一次，完成后应删除
4. **传输安全**: 建议使用 HTTPS 确保传输层安全

---

## 代码定位

- 后端路由: `synapse-rust/src/web/routes/rendezvous.rs`
- SDK 封装: `src/rendezvous/RendezvousManager.ts`
