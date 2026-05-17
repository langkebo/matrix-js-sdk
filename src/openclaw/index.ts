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
 * OpenClaw Manager - AI 连接与对话管理
 *
 * 提供连接管理、对话管理、消息管理、生成管理、角色管理功能
 * 对接后端: synapse-rust/src/web/routes/openclaw.rs
 */

import { Method } from "../http-api/method";
import { type Body } from "../http-api/interface";
import { MatrixClient } from "../client";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";
import type { OpenClawPathPattern } from "./__generated__/route-table";
import type {
    OpenClawConnection,
    CreateOpenClawConnectionRequest,
    UpdateOpenClawConnectionRequest,
    ConnectionTestResult,
    OpenClawConversation,
    CreateOpenClawConversationRequest,
    UpdateOpenClawConversationRequest,
    OpenClawMessage,
    SendMessageRequest,
    OpenClawGeneration,
    CreateGenerationRequest,
    OpenClawChatRole,
    CreateChatRoleRequest,
    UpdateChatRoleRequest,
    PaginatedResponse,
    PaginationParams,
} from "./__generated__/dto";

export type {
    OpenClawConnection,
    CreateOpenClawConnectionRequest,
    UpdateOpenClawConnectionRequest,
    ConnectionTestResult,
    OpenClawConversation,
    CreateOpenClawConversationRequest,
    UpdateOpenClawConversationRequest,
    OpenClawMessage,
    SendMessageRequest,
    OpenClawGeneration,
    CreateGenerationRequest,
    OpenClawChatRole,
    CreateChatRoleRequest,
    UpdateChatRoleRequest,
    PaginatedResponse,
    PaginationParams,
} from "./__generated__/dto";

const OPENCLAW_PREFIX = "/_matrix/client/unstable/org.synapse_rust.openclaw";

type StripOpenClawPrefix<P extends string> =
    P extends `${typeof OPENCLAW_PREFIX}${infer Rest}` ? Rest : never;

function oc<P extends StripOpenClawPrefix<OpenClawPathPattern>>(path: P): P {
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

    private request<T>(
        method: Method,
        path: string,
        queryParams?: Record<string, string>,
        body?: unknown,
    ): Promise<T> {
        return this.withRetry(async () => {
            return this.client.http.authedRequest(method, path, queryParams, body as Body | undefined, {
                prefix: OPENCLAW_PREFIX,
            }) as Promise<T>;
        }, "request");
    }

    // ===== Connections =====

    /** GET /connections */
    async listConnections(): Promise<OpenClawConnection[]> {
        return this.request<OpenClawConnection[]>(Method.Get, oc("/connections"));
    }

    /** POST /connections */
    async createConnection(req: CreateOpenClawConnectionRequest): Promise<OpenClawConnection> {
        this.requireNonEmptyString(req.name, "name");
        this.requireNonEmptyString(req.provider, "provider");
        this.requireNonEmptyString(req.base_url, "base_url");
        const result = await this.request<OpenClawConnection>(Method.Post, oc("/connections"), undefined, req);
        this.emit(OpenClawEvent.ConnectionCreated, result);
        return result;
    }

    /** GET /connections/{id} */
    async getConnection(id: number): Promise<OpenClawConnection> {
        this.requirePositiveInteger(id, "id");
        return this.request<OpenClawConnection>(
            Method.Get,
            oc(`/connections/${id}` as StripOpenClawPrefix<OpenClawPathPattern>),
        );
    }

    /** PUT /connections/{id} */
    async updateConnection(id: number, req: UpdateOpenClawConnectionRequest): Promise<OpenClawConnection> {
        this.requirePositiveInteger(id, "id");
        const result = await this.request<OpenClawConnection>(
            Method.Put,
            oc(`/connections/${id}` as StripOpenClawPrefix<OpenClawPathPattern>),
            undefined,
            req,
        );
        this.emit(OpenClawEvent.ConnectionUpdated, result);
        return result;
    }

    /** DELETE /connections/{id} */
    async deleteConnection(id: number): Promise<void> {
        this.requirePositiveInteger(id, "id");
        await this.request<void>(
            Method.Delete,
            oc(`/connections/${id}` as StripOpenClawPrefix<OpenClawPathPattern>),
        );
        this.emit(OpenClawEvent.ConnectionDeleted, id);
    }

    /** POST /connections/{id}/test */
    async testConnection(id: number): Promise<ConnectionTestResult> {
        this.requirePositiveInteger(id, "id");
        const result = await this.request<ConnectionTestResult>(
            Method.Post,
            oc(`/connections/${id}/test` as StripOpenClawPrefix<OpenClawPathPattern>),
        );
        this.emit(OpenClawEvent.ConnectionTested, result);
        return result;
    }

    // ===== Conversations =====

    /** GET /conversations */
    async listConversations(params?: PaginationParams): Promise<PaginatedResponse<OpenClawConversation>> {
        const q: Record<string, string> = {};
        if (params?.limit !== undefined) q.limit = String(params.limit);
        if (params?.offset !== undefined) q.offset = String(params.offset);
        if (params?.from) q.from = params.from;
        if (params?.before !== undefined) q.before = String(params.before);
        if (params?.type) q.type = params.type;
        return this.request<PaginatedResponse<OpenClawConversation>>(
            Method.Get,
            oc("/conversations"),
            Object.keys(q).length > 0 ? q : undefined,
        );
    }

    /** POST /conversations */
    async createConversation(req: CreateOpenClawConversationRequest): Promise<OpenClawConversation> {
        const result = await this.request<OpenClawConversation>(Method.Post, oc("/conversations"), undefined, req);
        this.emit(OpenClawEvent.ConversationCreated, result);
        return result;
    }

    /** GET /conversations/{id} */
    async getConversation(id: number): Promise<OpenClawConversation> {
        this.requirePositiveInteger(id, "id");
        return this.request<OpenClawConversation>(
            Method.Get,
            oc(`/conversations/${id}` as StripOpenClawPrefix<OpenClawPathPattern>),
        );
    }

    /** PUT /conversations/{id} */
    async updateConversation(id: number, req: UpdateOpenClawConversationRequest): Promise<OpenClawConversation> {
        this.requirePositiveInteger(id, "id");
        const result = await this.request<OpenClawConversation>(
            Method.Put,
            oc(`/conversations/${id}` as StripOpenClawPrefix<OpenClawPathPattern>),
            undefined,
            req,
        );
        this.emit(OpenClawEvent.ConversationUpdated, result);
        return result;
    }

    /** DELETE /conversations/{id} */
    async deleteConversation(id: number): Promise<void> {
        this.requirePositiveInteger(id, "id");
        await this.request<void>(
            Method.Delete,
            oc(`/conversations/${id}` as StripOpenClawPrefix<OpenClawPathPattern>),
        );
        this.emit(OpenClawEvent.ConversationDeleted, id);
    }

    // ===== Messages =====

    /** GET /conversations/{conversationId}/messages */
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
        return this.request<PaginatedResponse<OpenClawMessage>>(
            Method.Get,
            oc(`/conversations/${conversationId}/messages` as StripOpenClawPrefix<OpenClawPathPattern>),
            Object.keys(q).length > 0 ? q : undefined,
        );
    }

    /** POST /conversations/{conversationId}/messages */
    async sendMessage(conversationId: number, req: SendMessageRequest): Promise<OpenClawMessage> {
        this.requirePositiveInteger(conversationId, "conversationId");
        this.requireNonEmptyString(req.content, "content");
        const result = await this.request<OpenClawMessage>(
            Method.Post,
            oc(`/conversations/${conversationId}/messages` as StripOpenClawPrefix<OpenClawPathPattern>),
            undefined,
            req,
        );
        this.emit(OpenClawEvent.MessageSent, result);
        return result;
    }

    /** DELETE /messages/{id} */
    async deleteMessage(id: number): Promise<void> {
        this.requirePositiveInteger(id, "id");
        await this.request<void>(
            Method.Delete,
            oc(`/messages/${id}` as StripOpenClawPrefix<OpenClawPathPattern>),
        );
        this.emit(OpenClawEvent.MessageDeleted, id);
    }

    // ===== Generations =====

    /** GET /generations */
    async listGenerations(params?: PaginationParams): Promise<PaginatedResponse<OpenClawGeneration>> {
        const q: Record<string, string> = {};
        if (params?.limit !== undefined) q.limit = String(params.limit);
        if (params?.offset !== undefined) q.offset = String(params.offset);
        if (params?.from) q.from = params.from;
        if (params?.before !== undefined) q.before = String(params.before);
        if (params?.type) q.type = params.type;
        return this.request<PaginatedResponse<OpenClawGeneration>>(
            Method.Get,
            oc("/generations"),
            Object.keys(q).length > 0 ? q : undefined,
        );
    }

    /** POST /generations */
    async createGeneration(req: CreateGenerationRequest): Promise<OpenClawGeneration> {
        this.requireNonEmptyString(req.type, "type");
        this.requireNonEmptyString(req.prompt, "prompt");
        const result = await this.request<OpenClawGeneration>(Method.Post, oc("/generations"), undefined, req);
        this.emit(OpenClawEvent.GenerationCreated, result);
        return result;
    }

    /** GET /generations/{id} */
    async getGeneration(id: number): Promise<OpenClawGeneration> {
        this.requirePositiveInteger(id, "id");
        return this.request<OpenClawGeneration>(
            Method.Get,
            oc(`/generations/${id}` as StripOpenClawPrefix<OpenClawPathPattern>),
        );
    }

    /** DELETE /generations/{id} */
    async deleteGeneration(id: number): Promise<void> {
        this.requirePositiveInteger(id, "id");
        await this.request<void>(
            Method.Delete,
            oc(`/generations/${id}` as StripOpenClawPrefix<OpenClawPathPattern>),
        );
        this.emit(OpenClawEvent.GenerationDeleted, id);
    }

    // ===== Roles =====

    /** GET /roles */
    async listChatRoles(): Promise<OpenClawChatRole[]> {
        return this.request<OpenClawChatRole[]>(Method.Get, oc("/roles"));
    }

    /** POST /roles */
    async createChatRole(req: CreateChatRoleRequest): Promise<OpenClawChatRole> {
        this.requireNonEmptyString(req.name, "name");
        this.requireNonEmptyString(req.system_message, "system_message");
        const result = await this.request<OpenClawChatRole>(Method.Post, oc("/roles"), undefined, req);
        this.emit(OpenClawEvent.RoleCreated, result);
        return result;
    }

    /** GET /roles/{id} */
    async getChatRole(id: number): Promise<OpenClawChatRole> {
        this.requirePositiveInteger(id, "id");
        return this.request<OpenClawChatRole>(
            Method.Get,
            oc(`/roles/${id}` as StripOpenClawPrefix<OpenClawPathPattern>),
        );
    }

    /** PUT /roles/{id} */
    async updateChatRole(id: number, req: UpdateChatRoleRequest): Promise<OpenClawChatRole> {
        this.requirePositiveInteger(id, "id");
        const result = await this.request<OpenClawChatRole>(
            Method.Put,
            oc(`/roles/${id}` as StripOpenClawPrefix<OpenClawPathPattern>),
            undefined,
            req,
        );
        this.emit(OpenClawEvent.RoleUpdated, result);
        return result;
    }

    /** DELETE /roles/{id} */
    async deleteChatRole(id: number): Promise<void> {
        this.requirePositiveInteger(id, "id");
        await this.request<void>(
            Method.Delete,
            oc(`/roles/${id}` as StripOpenClawPrefix<OpenClawPathPattern>),
        );
        this.emit(OpenClawEvent.RoleDeleted, id);
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getOpenClawManager(): OpenClawManager;
    }
}

export function createOpenClawManager(client: MatrixClient): OpenClawManager {
    return getOrCreateManager(client, "OpenClawManager", () => new OpenClawManager(client));
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getOpenClawManager = function (): OpenClawManager {
        return getOrCreateManager(this, "openclaw", () => new OpenClawManager(this));
    };
}

export default extendMatrixClient;
