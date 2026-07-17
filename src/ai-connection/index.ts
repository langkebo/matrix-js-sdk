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
 * AI Connection Manager - AI 连接与 MCP 工具管理 API 封装
 *
 * 提供 AI 连接 CRUD 和 MCP（Model Context Protocol）工具调用功能
 * 对接后端: synapse-rust/src/web/routes/ai_connection.rs
 * API 前缀: /_matrix/client/v1/ai (v1) 和 /_matrix/client/v3/ai (v3)
 *
 * 使用方式:
 * ```typescript
 * const manager = client.getAIConnectionManager();
 * // 列出所有 AI 连接
 * const connections = await manager.listConnections();
 * // 创建新连接
 * const conn = await manager.createConnection({ provider: "openai" });
 * // 列出 MCP 工具
 * const tools = await manager.listMcpTools("openai");
 * // 调用 MCP 工具
 * const result = await manager.callMcpTool({ provider: "openai", tool_name: "search", arguments: { q: "test" } });
 * ```
 */

import { Method } from "../http-api/method";
import { type Body } from "../http-api/interface";
import { MatrixClient } from "../client";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { doesClientAdvertiseSynapseRustFeature, SynapseRustFeature } from "../server-capabilities";
import type { AiConnectionPathPattern } from "./__generated__/route-table";
import type {
    AIConnection as AIConnectionDto,
    CreateConnectionOptions as CreateConnectionOptionsDto,
    McpToolCallRequest as McpToolCallRequestDto,
} from "./__generated__/dto";

export type AIConnection = AIConnectionDto;
export type CreateConnectionOptions = CreateConnectionOptionsDto;
export type McpToolCallRequest = McpToolCallRequestDto;

export interface McpTool {
    name: string;
    description?: string;
    input_schema?: Record<string, unknown>; // Dynamic: JSON Schema for MCP tool input
}

export interface McpToolListResponse {
    tools: McpTool[];
}

export interface AIConnectionResult {
    output?: string;
    error?: string;
    [key: string]: unknown;
}

export interface McpToolCallResponse {
    result: AIConnectionResult;
}

export interface ConnectionListResponse {
    connections: AIConnection[];
    total: number;
}

const AI_V1_PREFIX = "/_matrix/client/v1/ai";
const AI_V3_PREFIX = "/_matrix/client/v3/ai";

type StripAiV1Prefix<P extends string> = P extends `${typeof AI_V1_PREFIX}${infer Rest}` ? Rest : never;

function ai<P extends StripAiV1Prefix<AiConnectionPathPattern>>(path: P): P {
    return path;
}

export enum AIConnectionEvent {
    ConnectionCreated = "ConnectionCreated",
    ConnectionUpdated = "ConnectionUpdated",
    ConnectionDeleted = "ConnectionDeleted",
    ToolCalled = "ToolCalled",
}

interface AIConnectionManagerEventMap {
    [AIConnectionEvent.ConnectionCreated]: (connection: AIConnection) => void;
    [AIConnectionEvent.ConnectionUpdated]: (connection: AIConnection) => void;
    [AIConnectionEvent.ConnectionDeleted]: (id: string) => void;
    [AIConnectionEvent.ToolCalled]: (result: McpToolCallResponse) => void;
}

export type AiApiVersion = "v1" | "v3";

export class AIConnectionManager extends BaseManager<AIConnectionEvent, AIConnectionManagerEventMap> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public async isSupported(): Promise<boolean> {
        return doesClientAdvertiseSynapseRustFeature(this.client, SynapseRustFeature.AIConnection, true);
    }

    private async resolveApiVersion(version?: AiApiVersion): Promise<AiApiVersion> {
        if (version) {
            return version;
        }

        const serverPrefersV3 = await doesClientAdvertiseSynapseRustFeature(
            this.client,
            SynapseRustFeature.AIConnection,
            false,
        );
        return serverPrefersV3 ? "v3" : "v1";
    }

    private getPrefix(version: AiApiVersion): string {
        return version === "v3" ? AI_V3_PREFIX : AI_V1_PREFIX;
    }

    private async doRequest<T>(
        method: Method,
        path: string,
        queryParams?: Record<string, string>,
        body?: unknown,
        version?: AiApiVersion,
    ): Promise<T> {
        const resolvedVersion = await this.resolveApiVersion(version);
        return this.withRetry(async () => {
            return this.request({
                method: method,
                path: path,
                queryParams: queryParams,
                body: body as Body | undefined,
                prefix: this.getPrefix(resolvedVersion),
            }) as Promise<T>;
        }, "request");
    }

    async listConnections(version?: AiApiVersion): Promise<AIConnection[]> {
        return this.doRequest<AIConnection[]>(Method.Get, ai("/connections"), undefined, undefined, version);
    }

    async createConnection(req: CreateConnectionOptions, version?: AiApiVersion): Promise<AIConnection> {
        this.requireNonEmptyString(req.provider, "provider");
        const result = await this.doRequest<AIConnection>(Method.Post, ai("/connections"), undefined, req, version);
        this.emit(AIConnectionEvent.ConnectionCreated, result);
        return result;
    }

    async getConnection(id: string, version?: AiApiVersion): Promise<AIConnection> {
        this.requireNonEmptyString(id, "id");
        return this.doRequest<AIConnection>(
            Method.Get,
            ai(`/connections/${id}` as StripAiV1Prefix<AiConnectionPathPattern>),
            undefined,
            undefined,
            version,
        );
    }

    async deleteConnection(id: string, version?: AiApiVersion): Promise<void> {
        this.requireNonEmptyString(id, "id");
        await this.doRequest<void>(
            Method.Delete,
            ai(`/connections/${id}` as StripAiV1Prefix<AiConnectionPathPattern>),
            undefined,
            undefined,
            version,
        );
        this.emit(AIConnectionEvent.ConnectionDeleted, id);
    }

    async listMcpTools(provider: string, version?: AiApiVersion): Promise<McpToolListResponse> {
        this.requireNonEmptyString(provider, "provider");
        return this.doRequest<McpToolListResponse>(Method.Get, ai("/mcp/tools"), { provider }, undefined, version);
    }

    async callMcpTool(req: McpToolCallRequest, version?: AiApiVersion): Promise<McpToolCallResponse> {
        this.requireNonEmptyString(req.provider, "provider");
        this.requireNonEmptyString(req.tool_name, "tool_name");
        const result = await this.doRequest<McpToolCallResponse>(
            Method.Post,
            ai("/mcp/tools/call"),
            undefined,
            req,
            version,
        );
        this.emit(AIConnectionEvent.ToolCalled, result);
        return result;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getAIConnectionManager = function (): AIConnectionManager {
        registerManagerClass("aiConnection", AIConnectionManager);
        return getOrCreateManager(this, "aiConnection", () => new AIConnectionManager(this));
    };
}
