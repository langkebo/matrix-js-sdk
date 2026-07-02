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
 * OpenClaw Manager - AI 对话与生成管理 API 封装
 *
 * 提供 AI 连接管理、对话管理、消息收发、内容生成、聊天角色管理等功能
 * 对接后端: synapse-rust/src/web/routes/openclaw/
 * API 前缀: /_matrix/client/unstable/org.synapse_rust.openclaw
 *
 * 使用方式:
 * ```typescript
 * const manager = client.getOpenClawManager();
 * // 列出所有 AI 连接
 * const connections = await manager.listConnections();
 * // 创建对话
 * const conversation = await manager.createConversation({ title: "New Chat" });
 * // 发送消息
 * const message = await manager.sendMessage(conversation.id, { content: "Hello!" });
 * ```
 */

import { Method } from "../http-api/method";

import { MatrixClient } from "../client";
import { BaseManager } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { doesClientAdvertiseSynapseRustFeature, SynapseRustFeature } from "../server-capabilities";
import type { OpenclawPathPattern } from "./__generated__/route-table";

/**
 * Arbitrary configuration values for an OpenClaw AI connection.
 * Shape varies by provider (e.g. OpenAI, Anthropic, local models).
 */
type OpenClawConfig = Record<string, unknown>; /* Dynamic: config shape varies by AI provider */

export interface OpenClawConnection {
    id: number;
    name: string;
    provider: string;
    base_url: string;
    has_api_key: boolean;
    config?: OpenClawConfig;
    is_default: boolean;
    is_active: boolean;
    created_ts: number;
    updated_ts: number;
}

export interface CreateOpenClawConnectionRequest {
    name: string;
    provider: string;
    base_url: string;
    api_key?: string;
    config?: OpenClawConfig;
    is_default?: boolean;
}

export interface UpdateOpenClawConnectionRequest {
    name?: string;
    base_url?: string;
    api_key?: string;
    config?: OpenClawConfig;
    is_default?: boolean;
    is_active?: boolean;
}

export interface ConnectionTestResult {
    success: boolean;
    message?: string;
    latency_ms?: number;
}

export interface OpenClawConversation {
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

export interface CreateOpenClawConversationRequest {
    connection_id?: number;
    title?: string;
    model_id?: string;
    system_prompt?: string;
    temperature?: number;
    max_tokens?: number;
}

export interface UpdateOpenClawConversationRequest {
    title?: string;
    model_id?: string;
    system_prompt?: string;
    temperature?: number;
    max_tokens?: number;
    is_pinned?: boolean;
}

export interface ToolCall {
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: string;
    };
}

export interface OpenClawMessage {
    id: number;
    conversation_id: number;
    role: string;
    content: string;
    token_count?: number;
    tool_calls?: ToolCall[];
    created_ts: number;
}

export interface SendMessageRequest {
    content: string;
    role?: string;
    metadata?: Record<string, unknown>; // Dynamic: arbitrary message metadata
}

export interface OpenClawGeneration {
    id: number;
    type: string;
    prompt: string;
    status: string;
    result_url?: string;
    created_ts: number;
    updated_ts: number;
}

export interface CreateGenerationRequest {
    type: string;
    prompt: string;
    model_id?: string;
    parameters?: Record<string, unknown>; // Dynamic: generation parameters vary by type
}

export interface OpenClawChatRole {
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

export interface CreateChatRoleRequest {
    name: string;
    system_message: string;
    description?: string;
    model_id?: string;
    avatar_url?: string;
    category?: string;
    temperature?: number;
    max_tokens?: number;
    is_public?: boolean;
}

export interface UpdateChatRoleRequest {
    name?: string;
    system_message?: string;
    description?: string;
    model_id?: string;
    avatar_url?: string;
    category?: string;
    temperature?: number;
    max_tokens?: number;
    is_public?: boolean;
}

export interface PaginationParams {
    limit?: number;
    offset?: number;
    from?: string;
    before?: number;
    type?: string;
}

export interface PaginatedResponse<T> {
    items: T[];
    total: number;
    has_more: boolean;
    next_offset?: number;
}

const OPENCLAW_PREFIX = "/_matrix/client/unstable/org.synapse_rust.openclaw";

type StripOpenClawPrefix<P extends string> =
    P extends `${typeof OPENCLAW_PREFIX}${infer Rest}` ? Rest : never;

function oc<P extends StripOpenClawPrefix<OpenclawPathPattern>>(path: P): P {
    return path;
}

export enum OpenClawEvent {
    ConnectionCreated = "ConnectionCreated",
    ConnectionUpdated = "ConnectionUpdated",
    ConnectionDeleted = "ConnectionDeleted",
    ConnectionTested = "ConnectionTested",
    ConversationCreated = "ConversationCreated",
    ConversationUpdated = "ConversationUpdated",
    ConversationDeleted = "ConversationDeleted",
    MessageSent = "MessageSent",
    MessageDeleted = "MessageDeleted",
    GenerationCreated = "GenerationCreated",
    GenerationDeleted = "GenerationDeleted",
    RoleCreated = "RoleCreated",
    RoleUpdated = "RoleUpdated",
    RoleDeleted = "RoleDeleted",
}

interface OpenClawManagerEventMap {
    [OpenClawEvent.ConnectionCreated]: (connection: OpenClawConnection) => void;
    [OpenClawEvent.ConnectionUpdated]: (connection: OpenClawConnection) => void;
    [OpenClawEvent.ConnectionDeleted]: (id: number) => void;
    [OpenClawEvent.ConnectionTested]: (result: ConnectionTestResult) => void;
    [OpenClawEvent.ConversationCreated]: (conversation: OpenClawConversation) => void;
    [OpenClawEvent.ConversationUpdated]: (conversation: OpenClawConversation) => void;
    [OpenClawEvent.ConversationDeleted]: (id: number) => void;
    [OpenClawEvent.MessageSent]: (message: OpenClawMessage) => void;
    [OpenClawEvent.MessageDeleted]: (id: number) => void;
    [OpenClawEvent.GenerationCreated]: (generation: OpenClawGeneration) => void;
    [OpenClawEvent.GenerationDeleted]: (id: number) => void;
    [OpenClawEvent.RoleCreated]: (role: OpenClawChatRole) => void;
    [OpenClawEvent.RoleUpdated]: (role: OpenClawChatRole) => void;
    [OpenClawEvent.RoleDeleted]: (id: number) => void;
}

export class OpenClawManager extends BaseManager<OpenClawEvent, OpenClawManagerEventMap> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async isSupported(): Promise<boolean> {
        return doesClientAdvertiseSynapseRustFeature(this.client, SynapseRustFeature.OpenClaw, true);
    }

    private doRequest<T>(
        method: Method,
        path: string,
        queryParams?: Record<string, string | string[]>,
        body?: unknown,
    ): Promise<T> {
        return this.request<T>({
            method, path, queryParams, body,
            prefix: OPENCLAW_PREFIX,
            retry: { label: "openclaw-request" },
        });
    }

    async listConnections(): Promise<OpenClawConnection[]> {
        return this.doRequest<OpenClawConnection[]>(Method.Get, oc("/connections"));
    }

    async createConnection(req: CreateOpenClawConnectionRequest): Promise<OpenClawConnection> {
        this.requireNonEmptyString(req.name, "name");
        this.requireNonEmptyString(req.provider, "provider");
        this.requireNonEmptyString(req.base_url, "base_url");
        const result = await this.doRequest<OpenClawConnection>(Method.Post, oc("/connections"), undefined, req);
        this.emit(OpenClawEvent.ConnectionCreated, result);
        return result;
    }

    async getConnection(id: number): Promise<OpenClawConnection> {
        this.requirePositiveInteger(id, "id");
        return this.doRequest<OpenClawConnection>(
            Method.Get,
            oc(`/connections/${id}` as StripOpenClawPrefix<OpenclawPathPattern>),
        );
    }

    async updateConnection(id: number, req: UpdateOpenClawConnectionRequest): Promise<OpenClawConnection> {
        this.requirePositiveInteger(id, "id");
        const result = await this.doRequest<OpenClawConnection>(
            Method.Put,
            oc(`/connections/${id}` as StripOpenClawPrefix<OpenclawPathPattern>),
            undefined,
            req,
        );
        this.emit(OpenClawEvent.ConnectionUpdated, result);
        return result;
    }

    async deleteConnection(id: number): Promise<void> {
        this.requirePositiveInteger(id, "id");
        await this.doRequest<void>(
            Method.Delete,
            oc(`/connections/${id}` as StripOpenClawPrefix<OpenclawPathPattern>),
        );
        this.emit(OpenClawEvent.ConnectionDeleted, id);
    }

    async testConnection(id: number): Promise<ConnectionTestResult> {
        this.requirePositiveInteger(id, "id");
        const result = await this.doRequest<ConnectionTestResult>(
            Method.Post,
            oc(`/connections/${id}/test` as StripOpenClawPrefix<OpenclawPathPattern>),
        );
        this.emit(OpenClawEvent.ConnectionTested, result);
        return result;
    }

    async listConversations(params?: PaginationParams): Promise<PaginatedResponse<OpenClawConversation>> {
        const q: Record<string, string> = {};
        if (params?.limit !== undefined) q.limit = String(params.limit);
        if (params?.offset !== undefined) q.offset = String(params.offset);
        if (params?.from) q.from = params.from;
        if (params?.before !== undefined) q.before = String(params.before);
        if (params?.type) q.type = params.type;
        return this.doRequest<PaginatedResponse<OpenClawConversation>>(
            Method.Get,
            oc("/conversations"),
            Object.keys(q).length > 0 ? q : undefined,
        );
    }

    async createConversation(req: CreateOpenClawConversationRequest): Promise<OpenClawConversation> {
        const result = await this.doRequest<OpenClawConversation>(Method.Post, oc("/conversations"), undefined, req);
        this.emit(OpenClawEvent.ConversationCreated, result);
        return result;
    }

    async getConversation(id: number): Promise<OpenClawConversation> {
        this.requirePositiveInteger(id, "id");
        return this.doRequest<OpenClawConversation>(
            Method.Get,
            oc(`/conversations/${id}` as StripOpenClawPrefix<OpenclawPathPattern>),
        );
    }

    async updateConversation(id: number, req: UpdateOpenClawConversationRequest): Promise<OpenClawConversation> {
        this.requirePositiveInteger(id, "id");
        const result = await this.doRequest<OpenClawConversation>(
            Method.Put,
            oc(`/conversations/${id}` as StripOpenClawPrefix<OpenclawPathPattern>),
            undefined,
            req,
        );
        this.emit(OpenClawEvent.ConversationUpdated, result);
        return result;
    }

    async deleteConversation(id: number): Promise<void> {
        this.requirePositiveInteger(id, "id");
        await this.doRequest<void>(
            Method.Delete,
            oc(`/conversations/${id}` as StripOpenClawPrefix<OpenclawPathPattern>),
        );
        this.emit(OpenClawEvent.ConversationDeleted, id);
    }

    async listMessages(
        conversationId: number,
        params?: PaginationParams,
    ): Promise<PaginatedResponse<OpenClawMessage>> {
        this.requirePositiveInteger(conversationId, "conversationId");
        const q: Record<string, string> = {};
        if (params?.limit !== undefined) q.limit = String(params.limit);
        if (params?.offset !== undefined) q.offset = String(params.offset);
        if (params?.from) q.from = params.from;
        if (params?.before !== undefined) q.before = String(params.before);
        if (params?.type) q.type = params.type;
        return this.doRequest<PaginatedResponse<OpenClawMessage>>(
            Method.Get,
            oc(`/conversations/${conversationId}/messages` as StripOpenClawPrefix<OpenclawPathPattern>),
            Object.keys(q).length > 0 ? q : undefined,
        );
    }

    async sendMessage(conversationId: number, req: SendMessageRequest): Promise<OpenClawMessage> {
        this.requirePositiveInteger(conversationId, "conversationId");
        this.requireNonEmptyString(req.content, "content");
        const result = await this.doRequest<OpenClawMessage>(
            Method.Post,
            oc(`/conversations/${conversationId}/messages` as StripOpenClawPrefix<OpenclawPathPattern>),
            undefined,
            req,
        );
        this.emit(OpenClawEvent.MessageSent, result);
        return result;
    }

    async sendConversationMessage(conversationId: number, message: string): Promise<OpenClawMessage> {
        return this.sendMessage(conversationId, { content: message });
    }

    async deleteMessage(id: number): Promise<void> {
        this.requirePositiveInteger(id, "id");
        await this.doRequest<void>(
            Method.Delete,
            oc(`/messages/${id}` as StripOpenClawPrefix<OpenclawPathPattern>),
        );
        this.emit(OpenClawEvent.MessageDeleted, id);
    }

    async listGenerations(params?: PaginationParams): Promise<PaginatedResponse<OpenClawGeneration>> {
        const q: Record<string, string> = {};
        if (params?.limit !== undefined) q.limit = String(params.limit);
        if (params?.offset !== undefined) q.offset = String(params.offset);
        if (params?.from) q.from = params.from;
        if (params?.before !== undefined) q.before = String(params.before);
        if (params?.type) q.type = params.type;
        return this.doRequest<PaginatedResponse<OpenClawGeneration>>(
            Method.Get,
            oc("/generations"),
            Object.keys(q).length > 0 ? q : undefined,
        );
    }

    async createGeneration(req: CreateGenerationRequest): Promise<OpenClawGeneration> {
        this.requireNonEmptyString(req.type, "type");
        this.requireNonEmptyString(req.prompt, "prompt");
        const result = await this.doRequest<OpenClawGeneration>(Method.Post, oc("/generations"), undefined, req);
        this.emit(OpenClawEvent.GenerationCreated, result);
        return result;
    }

    async getGeneration(id: number): Promise<OpenClawGeneration> {
        this.requirePositiveInteger(id, "id");
        return this.doRequest<OpenClawGeneration>(
            Method.Get,
            oc(`/generations/${id}` as StripOpenClawPrefix<OpenclawPathPattern>),
        );
    }

    async deleteGeneration(id: number): Promise<void> {
        this.requirePositiveInteger(id, "id");
        await this.doRequest<void>(
            Method.Delete,
            oc(`/generations/${id}` as StripOpenClawPrefix<OpenclawPathPattern>),
        );
        this.emit(OpenClawEvent.GenerationDeleted, id);
    }

    async listChatRoles(): Promise<OpenClawChatRole[]> {
        return this.doRequest<OpenClawChatRole[]>(Method.Get, oc("/roles"));
    }

    async createChatRole(req: CreateChatRoleRequest): Promise<OpenClawChatRole> {
        this.requireNonEmptyString(req.name, "name");
        this.requireNonEmptyString(req.system_message, "system_message");
        const result = await this.doRequest<OpenClawChatRole>(Method.Post, oc("/roles"), undefined, req);
        this.emit(OpenClawEvent.RoleCreated, result);
        return result;
    }

    async getChatRole(id: number): Promise<OpenClawChatRole> {
        this.requirePositiveInteger(id, "id");
        return this.doRequest<OpenClawChatRole>(
            Method.Get,
            oc(`/roles/${id}` as StripOpenClawPrefix<OpenclawPathPattern>),
        );
    }

    async updateChatRole(id: number, req: UpdateChatRoleRequest): Promise<OpenClawChatRole> {
        this.requirePositiveInteger(id, "id");
        const result = await this.doRequest<OpenClawChatRole>(
            Method.Put,
            oc(`/roles/${id}` as StripOpenClawPrefix<OpenclawPathPattern>),
            undefined,
            req,
        );
        this.emit(OpenClawEvent.RoleUpdated, result);
        return result;
    }

    async deleteChatRole(id: number): Promise<void> {
        this.requirePositiveInteger(id, "id");
        await this.doRequest<void>(
            Method.Delete,
            oc(`/roles/${id}` as StripOpenClawPrefix<OpenclawPathPattern>),
        );
        this.emit(OpenClawEvent.RoleDeleted, id);
    }
}


export function createOpenClawManager(client: MatrixClient): OpenClawManager {
    return getOrCreateManager(client, "OpenClawManager", () => new OpenClawManager(client));
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getOpenClawManager = function (): OpenClawManager {
        registerManagerClass("openclaw", OpenClawManager);
    return getOrCreateManager(this, "openclaw", () => new OpenClawManager(this));
    };
}

export default extendMatrixClient;
