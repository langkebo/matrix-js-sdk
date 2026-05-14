/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * AI Connection Manager - AI 连接管理 + MCP 工具代理
 *
 * 对接后端 synapse-rust/src/web/routes/ai_connection.rs
 *
 * 后端 API (根路径, 无 Matrix prefix):
 *   GET  /connections
 *   POST /connections
 *   GET  /connections/{id}
 *   DELETE /connections/{id}
 *   GET  /mcp/tools?provider=X
 *   POST /mcp/tools/call
 *
 * 路由直接 merge 到主路由, 无独立 prefix (见 assembly.rs create_ai_connection_router())
 */

import { BaseManager } from "../managers/base-manager.js";
import { Method } from "../http-api/method.js";
import { MatrixClient } from "../client.js";
import { InvalidParamError } from "../common/errors";
import type { AiConnectionPathPattern } from "./__generated__/route-table";
import { getOrCreateManager } from "../client-infra/manager-registry";

function ap<P extends AiConnectionPathPattern>(path: P): P {
    return path;
}

export enum AIConnectionEvent {
    ConnectionCreated = "ConnectionCreated",
    ConnectionDeleted = "ConnectionDeleted",
    ConnectionUpdated = "ConnectionUpdated",
    ToolCalled = "ToolCalled",
    Error = "Error",
}

/**
 * AI 连接 - 对应后端 storage/ai_connection.rs AiConnection 结构体
 */
export interface AIConnection {
    id: string;
    user_id: string;
    /** AI provider 标识, 如 "openai", "anthropic", "claude" 等 */
    provider: string;
    /** 配置 JSON, 通常包含 { mcp_url: string } */
    config: Record<string, unknown> | null;
    is_active: boolean;
    created_ts: number;
    updated_ts: number | null;
}

export interface CreateConnectionOptions {
    /** AI provider 标识 */
    provider: string;
    /** 配置对象, 通常包含 mcp_url */
    config?: Record<string, unknown>;
}

export interface UpdateConnectionOptions {
    is_active?: boolean;
    config?: Record<string, unknown>;
}

export interface McpToolCallOptions {
    /** AI provider 标识 */
    provider: string;
    /** 要调用的 MCP 工具名称 */
    toolName: string;
    /** 工具参数 */
    arguments?: Record<string, unknown>;
}

export interface McpTool {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
}

interface AIConnectionManagerEventMap {
    [AIConnectionEvent.ConnectionCreated]: (connection: AIConnection) => void;
    [AIConnectionEvent.ConnectionDeleted]: (connectionId: string) => void;
    [AIConnectionEvent.ConnectionUpdated]: (connection: AIConnection) => void;
    [AIConnectionEvent.ToolCalled]: (toolName: string, result: unknown) => void;
    [AIConnectionEvent.Error]: (error: Error) => void;
}

export class AIConnectionManager extends BaseManager<AIConnectionEvent, AIConnectionManagerEventMap> {
    private connectionsCache: Map<string, AIConnection> = new Map();

    constructor(client: MatrixClient) {
        super(client);
    }

    /**
     * 获取当前用户所有 AI 连接
     * GET /connections
     */
    public async getConnections(): Promise<AIConnection[]> {
        try {
            const connections = await this.client.http.authedRequest<AIConnection[]>(
                Method.Get,
                ap("/connections"),
                undefined,
                undefined,
                { prefix: "" },
            );

            this.connectionsCache.clear();
            for (const conn of connections) {
                this.connectionsCache.set(conn.id, conn);
            }

            return connections;
        } catch (error) {
            throw this.normalizeError(error, "getConnections");
        }
    }

    /**
     * 创建新的 AI 连接
     * POST /connections { provider, config? }
     */
    public async createConnection(options: CreateConnectionOptions): Promise<AIConnection> {
        if (!options.provider) {
            throw new InvalidParamError("provider is required");
        }

        try {
            const connection = await this.client.http.authedRequest<AIConnection>(
                Method.Post,
                ap("/connections"),
                undefined,
                {
                    provider: options.provider,
                    config: options.config ?? null,
                },
                { prefix: "" },
            );

            this.connectionsCache.set(connection.id, connection);
            this.emit(AIConnectionEvent.ConnectionCreated, connection);

            return connection;
        } catch (error) {
            this.emit(AIConnectionEvent.Error, this.normalizeError(error, "createConnection") as Error);
            throw this.normalizeError(error, "createConnection");
        }
    }

    /**
     * 获取指定 ID 的 AI 连接
     * GET /connections/{id}
     */
    public async getConnection(connectionId: string): Promise<AIConnection> {
        if (!connectionId) {
            throw new InvalidParamError("connectionId is required");
        }

        try {
            const connection = await this.client.http.authedRequest<AIConnection>(
                Method.Get,
                ap(`/connections/${encodeURIComponent(connectionId)}` as AiConnectionPathPattern),
                undefined,
                undefined,
                { prefix: "" },
            );

            this.connectionsCache.set(connection.id, connection);
            this.emit(AIConnectionEvent.ConnectionUpdated, connection);

            return connection;
        } catch (error) {
            throw this.normalizeError(error, "getConnection");
        }
    }

    /**
     * 删除 AI 连接
     * DELETE /connections/{id}
     */
    public async deleteConnection(connectionId: string): Promise<void> {
        if (!connectionId) {
            throw new InvalidParamError("connectionId is required");
        }

        try {
            await this.client.http.authedRequest(
                Method.Delete,
                ap(`/connections/${encodeURIComponent(connectionId)}` as AiConnectionPathPattern),
                undefined,
                undefined,
                { prefix: "" },
            );

            this.connectionsCache.delete(connectionId);
            this.emit(AIConnectionEvent.ConnectionDeleted, connectionId);
        } catch (error) {
            this.emit(AIConnectionEvent.Error, this.normalizeError(error, "deleteConnection") as Error);
            throw this.normalizeError(error, "deleteConnection");
        }
    }

    /**
     * 获取指定 provider 的 MCP 工具列表
     * GET /mcp/tools?provider=X
     */
    public async listMcpTools(provider: string): Promise<unknown> {
        if (!provider) {
            throw new InvalidParamError("provider is required");
        }

        try {
            const result = await this.client.http.authedRequest<unknown>(
                Method.Get,
                ap("/mcp/tools"),
                { provider },
                undefined,
                { prefix: "" },
            );

            return result;
        } catch (error) {
            throw this.normalizeError(error, "listMcpTools");
        }
    }

    /**
     * 调用 MCP 工具
     * POST /mcp/tools/call { provider, tool_name, arguments }
     */
    public async callMcpTool(options: McpToolCallOptions): Promise<unknown> {
        if (!options.provider) {
            throw new InvalidParamError("provider is required");
        }
        if (!options.toolName) {
            throw new InvalidParamError("toolName is required");
        }

        try {
            const result = await this.client.http.authedRequest<unknown>(
                Method.Post,
                ap("/mcp/tools/call"),
                undefined,
                {
                    provider: options.provider,
                    tool_name: options.toolName,
                    arguments: options.arguments ?? {},
                },
                { prefix: "" },
            );

            this.emit(AIConnectionEvent.ToolCalled, options.toolName, result);

            return result;
        } catch (error) {
            this.emit(AIConnectionEvent.Error, this.normalizeError(error, "callMcpTool") as Error);
            throw this.normalizeError(error, "callMcpTool");
        }
    }

    /**
     * 列出所有已缓存的连接 (不发起网络请求)
     */
    public getCachedConnections(): AIConnection[] {
        return Array.from(this.connectionsCache.values());
    }

    /**
     * 从缓存获取指定连接 (不发起网络请求)
     */
    public getCachedConnection(connectionId: string): AIConnection | undefined {
        return this.connectionsCache.get(connectionId);
    }

    /**
     * 清除本地缓存
     */
    public clearCache(): void {
        this.connectionsCache.clear();
    }

    /**
     * 停止并清理
     */
    public stop(): void {
        this.connectionsCache.clear();
    }
}

declare module "../client.js" {
    interface MatrixClient {
        getAIConnectionManager(): AIConnectionManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getAIConnectionManager = function (): AIConnectionManager {
        return getOrCreateManager(this, "aiConnection", () => new AIConnectionManager(this));
    };
}

export default extendMatrixClient;
