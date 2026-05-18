---
module: openclaw
generated_from: docs/api-contract/generated/modules/openclaw.json
generated_hash: sha256-9949e69cd51dc312a7e40814e6ebaf082f3fe24c447da5135a0d81e9234f044e
ledger_schema: 1
last_reviewed: 2026-05-11
---

# OpenClaw 契约

> 审查来源: `synapse-rust/src/web/routes/openclaw.rs`

## 模块概述

OpenClaw 模块提供 AI 连接管理、对话、消息发送、内容生成以及聊天角色（Role）管理功能。
所有路由均挂载在 `/_matrix/client/unstable/org.synapse_rust.openclaw` 路径下。

## 真实后端路由

| 方法   | 路径                                                                                     | 说明                 | 认证 |
| ------ | ---------------------------------------------------------------------------------------- | -------------------- | ---- |
| GET    | `/connections`                                                                           | 列出所有 AI 连接     | 用户 |
| POST   | `/connections`                                                                           | 创建 AI 连接         | 用户 |
| GET    | `/connections/{id}`                                                                      | 获取指定连接详情     | 用户 |
| PUT    | `/connections/{id}`                                                                      | 更新指定连接详情     | 用户 |
| DELETE | `/connections/{id}`                                                                      | 删除指定连接         | 用户 |
| POST   | `/connections/{id}/test`                                                                 | 测试连接可用性       | 用户 |
| GET    | `/conversations`                                                                         | 列出所有对话         | 用户 |
| POST   | `/conversations`                                                                         | 创建对话             | 用户 |
| GET    | `/conversations/{id}`                                                                    | 获取指定对话详情     | 用户 |
| PUT    | `/conversations/{id}`                                                                    | 更新指定对话详情     | 用户 |
| DELETE | `/conversations/{id}`                                                                    | 删除指定对话         | 用户 |
| GET    | `/conversations/{id}/messages`                                                           | 列出指定对话的所有消息 | 用户 |
| POST   | `/conversations/{id}/messages`                                                           | 向对话发送消息       | 用户 |
| DELETE | `/messages/{id}`                                                                         | 删除指定消息         | 用户 |
| GET    | `/generations`                                                                           | 列出所有生成记录     | 用户 |
| POST   | `/generations`                                                                           | 创建生成任务         | 用户 |
| GET    | `/generations/{id}`                                                                      | 获取指定生成记录详情 | 用户 |
| DELETE | `/generations/{id}`                                                                      | 删除指定生成记录     | 用户 |
| GET    | `/roles`                                                                                 | 列出所有聊天角色     | 用户 |
| POST   | `/roles`                                                                                 | 创建聊天角色         | 用户 |
| GET    | `/roles/{id}`                                                                            | 获取指定角色详情     | 用户 |
| PUT    | `/roles/{id}`                                                                            | 更新指定角色详情     | 用户 |
| DELETE | `/roles/{id}`                                                                            | 删除指定角色         | 用户 |

## 端点详情

### 1. AI 连接 (Connections)

连接定义了如何接入外部 AI 提供商（如 OpenAI, Claude 等）。

**响应体 (IOpenClawConnection)**:
```typescript
export interface IOpenClawConnection {
    id: number;
    name: string;
    provider: string;
    base_url: string;
    has_api_key: boolean;
    config?: Record<string, unknown>;
    is_default: boolean;
    is_active: boolean;
    created_ts: number;
    updated_ts: number;
}
```

### 2. 对话 (Conversations)

**响应体 (IOpenClawConversation)**:
```typescript
export interface IOpenClawConversation {
    id: number;
    connection_id?: number;
    title?: string;
    model_id?: string;
    system_prompt?: string;
    temperature?: number;
    max_tokens?: number;
    is_pinned: boolean;
    created_ts: number;
    updated_ts: number;
}
```

### 3. 消息 (Messages)

**响应体 (IOpenClawMessage)**:
```typescript
export interface IOpenClawMessage {
    id: number;
    conversation_id: number;
    role: string; // "user", "assistant", "system", "tool"
    content: string;
    token_count?: number;
    tool_calls?: Record<string, unknown>;
    created_ts: number;
}
```

### 4. 角色 (Roles)

角色预设了 AI 的身份和行为（System Message）。

**响应体 (IOpenClawChatRole)**:
```typescript
export interface IOpenClawChatRole {
    id: number;
    name: string;
    description?: string;
    system_message: string;
    model_id?: string;
    avatar_url?: string;
    category?: string;
    temperature?: number;
    max_tokens?: number;
    is_public: boolean;
    created_ts: number;
    updated_ts: number;
}
```

## SDK 对齐状态

- **封装 Manager**: `OpenClawManager`
- **挂载位置**: `MatrixClient.getOpenClawManager()`
- **路径绑定**: 已通过 `OpenclawPathPattern` 绑定所有 23 条路由。
- **状态**: ✅ 100% 完善

## 覆盖率口径

- **后端 Ledger 路由数**: 23
- **SDK 已封装路由数**: 23
- **已绑定生成路由模板**: 23
- **契约覆盖率**: 100%
