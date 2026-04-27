# AI Connection API 契约文档

> 后端代码: `synapse-rust/src/web/routes/ai_connection.rs`  
> 装配入口: `synapse-rust/src/web/routes/assembly.rs`  
> 更新日期: 2026-04-27  
> 挂载版本: `v1` (实验性)

## 一、模块概述

### 1.1 功能描述

AI Connection API 提供 AI 服务集成功能，支持 MCP (Model Context Protocol) 工具调用。

### 1.2 路由前缀

- `/_matrix/client/v1/ai/connections`
- `/_matrix/client/v1/mcp/tools`

### 1.3 认证要求

- 所有端点需要 `AuthenticatedUser`

## 二、端点详情

### 2.1 查询 AI 连接

**路径**: `GET /_matrix/client/v1/ai/connections`  
**认证**: `AuthenticatedUser`

**响应**: `200 OK`
```typescript
interface AIConnectionsResponse {
  connections: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
  }>;
}
```

### 2.2 创建 AI 连接

**路径**: `POST /_matrix/client/v1/ai/connections`  
**认证**: `AuthenticatedUser`

**请求体**:
```json
{
  "name": "My AI Assistant",
  "type": "openai",
  "config": {
    "api_key": "...",
    "model": "gpt-4"
  }
}
```

**响应**: `201 Created`
```json
{
  "id": "conn_abc123"
}
```

### 2.3 查询单个 AI 连接

**路径**: `GET /_matrix/client/v1/ai/connections/{id}`  
**认证**: `AuthenticatedUser`

**响应**: `200 OK`
```typescript
interface AIConnection {
  id: string;
  name: string;
  type: string;
  status: string;
  config: Record<string, unknown>;
}
```

### 2.4 删除 AI 连接

**路径**: `DELETE /_matrix/client/v1/ai/connections/{id}`  
**认证**: `AuthenticatedUser`

**响应**: `200 OK`

### 2.5 查询 MCP 工具

**路径**: `GET /_matrix/client/v1/mcp/tools`  
**认证**: `AuthenticatedUser`

**响应**: `200 OK`
```typescript
interface MCPToolsResponse {
  tools: Array<{
    name: string;
    description: string;
    parameters: object;
  }>;
}
```

### 2.6 调用 MCP 工具

**路径**: `POST /_matrix/client/v1/mcp/tools/call`  
**认证**: `AuthenticatedUser`

**请求体**:
```json
{
  "tool": "search",
  "parameters": {
    "query": "..."
  }
}
```

**响应**: `200 OK`
```json
{
  "result": {}
}
```

## 三、SDK 对齐状态

### 3.1 封装覆盖率

- **总端点数**: 6
- **已封装**: 0
- **覆盖率**: 0%

### 3.2 已知差异

- 这是实验性 API，可能会有变更
- 建议在生产环境使用前确认稳定性

## 四、变更历史

| 日期 | 变更 | 影响 |
|------|------|------|
| 2026-04-27 | 初版 | - |
