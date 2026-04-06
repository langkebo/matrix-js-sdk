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
 * AI Connection Manager - AI 连接管理
 * 
 * 提供通过后端服务器管理 AI 连接的功能
 * 
 * 对应后端 API:
 * - GET /connections
 * - POST /connections
 * - GET /connections/{id}
 * - DELETE /connections/{id}
 * - GET /mcp/tools
 * - POST /mcp/tools/call
 */

import { logger } from "../logger.ts";
import { TypedEventEmitter } from "../models/typed-event-emitter.ts";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";
import { MatrixClient } from "../client";

export enum AIConnectionEvent {
    ConnectionCreated = "ConnectionCreated",
    ConnectionDeleted = "ConnectionDeleted",
    ConnectionUpdated = "ConnectionUpdated",
    ToolCalled = "ToolCalled",
    Error = "Error",
}

export interface IAIConnection {
    id: string;
    name: string;
    type: string;
    config: Record<string, unknown>;
    created_at?: number;
    updated_at?: number;
    status?: string;
}

export interface ICreateConnectionRequest {
    name: string;
    type: string;
    config: Record<string, unknown>;
}

export interface IAIConnectionResponse {
    connection: IAIConnection;
}

export interface IAIConnectionsResponse {
    connections: IAIConnection[];
}

export interface IAITool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

export interface IAIToolsResponse {
    tools: IAITool[];
}

export interface ICallToolRequest {
    name: string;
    arguments?: Record<string, unknown>;
}

export interface ICallToolResponse {
    content: Array<{
        type: string;
        text?: string;
        data?: unknown;
    }>;
    isError?: boolean;
}

interface AIConnectionManagerEventMap {
    [AIConnectionEvent.ConnectionCreated]: (connection: IAIConnection) => void;
    [AIConnectionEvent.ConnectionDeleted]: (connectionId: string) => void;
    [AIConnectionEvent.ConnectionUpdated]: (connection: IAIConnection) => void;
    [AIConnectionEvent.ToolCalled]: (toolName: string, result: ICallToolResponse) => void;
    [AIConnectionEvent.Error]: (error: Error) => void;
}

export class AIConnectionManager extends TypedEventEmitter<AIConnectionEvent, AIConnectionManagerEventMap> {
    private client: MatrixClient;
    private connections: Map<string, IAIConnection> = new Map();
    private tools: IAITool[] = [];

    constructor(client: MatrixClient) {
        super();
        this.client = client;
    }

    public async getConnections(): Promise<IAIConnection[]> {
        try {
            const response = await this.client.http.authedRequest<IAIConnectionsResponse>(
                Method.Get,
                "/connections",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );

            const connections = response.connections || [];
            this.connections.clear();
            for (const conn of connections) {
                this.connections.set(conn.id, conn);
            }

            return connections;
        } catch (error) {
            logger.warn("AIConnectionManager.getConnections failed:", error);
            throw error;
        }
    }

    public async getConnection(connectionId: string): Promise<IAIConnection> {
        if (!connectionId) {
            throw new Error("Connection ID is required");
        }

        try {
            const response = await this.client.http.authedRequest<IAIConnectionResponse>(
                Method.Get,
                `/connections/${encodeURIComponent(connectionId)}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );

            const connection = response.connection;
            this.connections.set(connection.id, connection);
            this.emit(AIConnectionEvent.ConnectionUpdated, connection);

            return connection;
        } catch (error) {
            logger.warn(`AIConnectionManager.getConnection failed for ${connectionId}:`, error);
            throw error;
        }
    }

    public async createConnection(request: ICreateConnectionRequest): Promise<IAIConnection> {
        if (!request.name) {
            throw new Error("Connection name is required");
        }

        if (!request.type) {
            throw new Error("Connection type is required");
        }

        try {
            const response = await this.client.http.authedRequest<IAIConnectionResponse>(
                Method.Post,
                "/connections",
                undefined,
                request,
                { prefix: ClientPrefix.V3 }
            );

            const connection = response.connection;
            this.connections.set(connection.id, connection);
            this.emit(AIConnectionEvent.ConnectionCreated, connection);

            return connection;
        } catch (error) {
            this.emit(AIConnectionEvent.Error, error as Error);
            throw error;
        }
    }

    public async deleteConnection(connectionId: string): Promise<void> {
        if (!connectionId) {
            throw new Error("Connection ID is required");
        }

        try {
            await this.client.http.authedRequest(
                Method.Delete,
                `/connections/${encodeURIComponent(connectionId)}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );

            this.connections.delete(connectionId);
            this.emit(AIConnectionEvent.ConnectionDeleted, connectionId);
        } catch (error) {
            this.emit(AIConnectionEvent.Error, error as Error);
            throw error;
        }
    }

    public async listTools(connectionId?: string): Promise<IAITool[]> {
        try {
            const query = connectionId ? { connection_id: connectionId } : undefined;
            const response = await this.client.http.authedRequest<IAIToolsResponse>(
                Method.Get,
                "/mcp/tools",
                query,
                undefined,
                { prefix: ClientPrefix.V3 }
            );

            this.tools = response.tools || [];
            return this.tools;
        } catch (error) {
            logger.warn("AIConnectionManager.listTools failed:", error);
            throw error;
        }
    }

    public async callTool(request: ICallToolRequest, connectionId?: string): Promise<ICallToolResponse> {
        if (!request.name) {
            throw new Error("Tool name is required");
        }

        try {
            const body: Record<string, unknown> = {
                name: request.name,
            };

            if (request.arguments) {
                body.arguments = request.arguments;
            }

            if (connectionId) {
                body.connection_id = connectionId;
            }

            const response = await this.client.http.authedRequest<ICallToolResponse>(
                Method.Post,
                "/mcp/tools/call",
                undefined,
                body,
                { prefix: ClientPrefix.V3 }
            );

            this.emit(AIConnectionEvent.ToolCalled, request.name, response);

            return response;
        } catch (error) {
            this.emit(AIConnectionEvent.Error, error as Error);
            throw error;
        }
    }

    public getCachedConnection(connectionId: string): IAIConnection | undefined {
        return this.connections.get(connectionId);
    }

    public getCachedConnections(): IAIConnection[] {
        return Array.from(this.connections.values());
    }

    public getCachedTools(): IAITool[] {
        return [...this.tools];
    }

    public clearCache(): void {
        this.connections.clear();
        this.tools = [];
    }

    public stop(): void {
        this.connections.clear();
        this.tools = [];
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getAIConnectionManager(): AIConnectionManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getAIConnectionManager = function (): AIConnectionManager {
        return new AIConnectionManager(this);
    };
}

export default extendMatrixClient;
