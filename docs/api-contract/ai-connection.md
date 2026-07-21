---
module: ai_connection
generated_from: docs/api-contract/generated/modules/ai_connection.json
generated_hash: sha256-01ad7947bd4b74e66336d149cb24f0456ac69df1c3b4a59eeb2139c34e88945a
ledger_schema: 1
last_reviewed: 2026-05-11
---

# AI Connection API 契约文档

> 后端代码: `synapse-rust/src/web/routes/ai_connection.rs`  
> 装配入口: `synapse-rust/src/web/routes/assembly.rs`  
> SDK 入口: `src/ai-connection/index.ts`  
> 更新日期: 2026-05-11  
> 挂载版本: `v1` (实验性)

## 一、当前审计结论

- `generated/modules/ai_connection.json` 记录 **6** 条路由，且这些路径是直接 merge 到主路由的相对路径，不带 `/_matrix/client/v1/ai` 前缀。
- SDK 已有 `AIConnectionManager`，本轮补上生成的 `AiConnectionPathPattern` 路径绑定，运行时路径仍保持根路径透传。
- 旧文档中的 `name` / `type` / `status` 结构与后端真实存储结构不符；真实字段是 `provider`、`config`、`is_active`、`created_ts`、`updated_ts`。
- MCP 工具查询与调用在后端都透传 `serde_json::Value`，不应在文档里写死为固定 `tools[]` / `{ result: {} }` 结构。

## 二、认证与路由前缀

- 所有端点需要 `AuthenticatedUser`
- 路由直接挂在主路由树上，SDK 通过 `authedRequest(..., { prefix: "" })` 访问
- 真实路径:
    - `/connections`
    - `/connections/{id}`
    - `/mcp/tools`
    - `/mcp/tools/call`

## 三、核心请求与响应形状

```typescript
interface AIConnection {
    id: string;
    user_id: string;
    provider: string;
    config: Record<string, unknown> | null;
    is_active: boolean;
    created_ts: number;
    updated_ts: number | null;
}
```

```typescript
interface CreateConnectionOptions {
    provider: string;
    config?: Record<string, unknown>;
}
```

```typescript
interface McpToolCallRequest {
    provider: string;
    tool_name: string;
    arguments: Record<string, unknown>;
}
```

补充说明:

- `GET /connections` 直接返回 `AIConnection[]`，不是 `{ connections: [...] }` 包装对象。
- `POST /connections` 直接返回新建后的完整 `AIConnection`。
- `GET /connections/{id}` 直接返回完整 `AIConnection`。
- `DELETE /connections/{id}` 后端返回空 JSON 值，SDK 方法 `deleteConnection()` 约定为 `Promise<void>`。
- `GET /mcp/tools?provider=...` 返回的是代理层透传的任意 JSON 值，SDK 当前保持 `unknown`。
- `POST /mcp/tools/call` 请求体使用 `{ provider, tool_name, arguments }`，不是旧文档中的 `{ tool, parameters }`。
- `POST /mcp/tools/call` 的响应同样是代理透传 JSON，SDK 当前保持 `unknown`。

## 四、路由与 SDK 对齐表

| 方法   | 路径                | SDK 方法             |
| ------ | ------------------- | -------------------- |
| GET    | `/connections`      | `getConnections()`   |
| POST   | `/connections`      | `createConnection()` |
| GET    | `/connections/{id}` | `getConnection()`    |
| DELETE | `/connections/{id}` | `deleteConnection()` |
| GET    | `/mcp/tools`        | `listMcpTools()`     |
| POST   | `/mcp/tools/call`   | `callMcpTool()`      |

## 五、SDK 对齐状态

- **总端点数**: 6
- **已封装**: 6
- **覆盖率**: 100%
- **路径绑定**: `src/ai-connection/index.ts` 使用 `AiConnectionPathPattern`
- **验证状态**: `spec/unit/ai-connection.spec.ts`
- **实验性质**: MCP 返回体透传上游 JSON，调用方不应依赖固定 schema

## 六、变更历史

| 日期       | 变更                                                                                | 影响             |
| ---------- | ----------------------------------------------------------------------------------- | ---------------- |
| 2026-05-11 | 修正文档中错误的路径前缀、字段命名与 MCP 请求/响应口径，并补充 SDK 生成路由绑定说明 | 修复长期文档漂移 |
| 2026-04-27 | 初版                                                                                | -                |
