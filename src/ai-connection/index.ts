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

import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { BaseManager } from "../managers/base-manager";
import { MatrixClient } from "../client";
import { getOrCreateManager } from "../client-infra/manager-registry";

export enum AIConnectionEvent {
    ConnectionCreated = "ConnectionCreated",
    ConnectionUpdated = "ConnectionUpdated",
    ConnectionDeleted = "ConnectionDeleted",
    ToolCalled = "ToolCalled",
}

export interface AiConnection {
    id: string;
    user_id: string;
    provider: string;
    config?: Record<string, unknown>;
    is_active: boolean;
    created_ts: number;
    updated_ts?: number;
}

export interface CreateConnectionRequest {
    provider: string;
    config?: Record<string, unknown>;
}

export interface McpToolCallRequest {
    provider: string;
    tool_name: string;
    arguments: Record<string, unknown>;
}

interface AIConnectionManagerEventMap {
    [AIConnectionEvent.ConnectionCreated]: (connection: AiConnection) => void;
    [AIConnectionEvent.ConnectionUpdated]: (connection: AiConnection) => void;
    [AIConnectionEvent.ConnectionDeleted]: (id: string) => void;
    [AIConnectionEvent.ToolCalled]: (result: Record<string, unknown>) => void;
}

export class AIConnectionManager extends BaseManager<AIConnectionEvent, AIConnectionManagerEventMap> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async listConnections(): Promise<AiConnection[]> {
        return this.withRetry(async () => {
            return await this.client.http.authedRequest<AiConnection[]>(
                Method.Get,
                "/connections",
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );
        }, "listConnections");
    }

    public async createConnection(request: CreateConnectionRequest): Promise<AiConnection> {
        this.requireNonEmptyString(request.provider, "provider");
        return this.withRetry(async () => {
            return await this.client.http.authedRequest<AiConnection>(
                Method.Post,
                "/connections",
                undefined,
                request as unknown as Record<string, unknown>,
                { prefix: ClientPrefix.V1 },
            );
        }, "createConnection");
    }

    public async getConnection(id: string): Promise<AiConnection> {
        this.requireNonEmptyString(id, "id");
        return this.withRetry(async () => {
            return await this.client.http.authedRequest<AiConnection>(
                Method.Get,
                `/connections/${id}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );
        }, "getConnection");
    }

    public async deleteConnection(id: string): Promise<void> {
        this.requireNonEmptyString(id, "id");
        return this.withRetry(async () => {
            await this.client.http.authedRequest<void>(
                Method.Delete,
                `/connections/${id}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );
        }, "deleteConnection");
    }

    public async listMcpTools(provider: string): Promise<Record<string, unknown>> {
        this.requireNonEmptyString(provider, "provider");
        return this.withRetry(async () => {
            return await this.client.http.authedRequest<Record<string, unknown>>(
                Method.Get,
                "/mcp/tools",
                { provider },
                undefined,
                { prefix: ClientPrefix.V1 },
            );
        }, "listMcpTools");
    }

    public async callMcpTool(request: McpToolCallRequest): Promise<Record<string, unknown>> {
        this.requireNonEmptyString(request.provider, "provider");
        this.requireNonEmptyString(request.tool_name, "tool_name");
        return this.withRetry(async () => {
            return await this.client.http.authedRequest<Record<string, unknown>>(
                Method.Post,
                "/mcp/tools/call",
                undefined,
                request as unknown as Record<string, unknown>,
                { prefix: ClientPrefix.V1 },
            );
        }, "callMcpTool");
    }
}

declare module "../client.ts" {
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
