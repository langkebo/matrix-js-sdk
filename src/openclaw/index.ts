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

import { MatrixClient } from "../client";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { BaseManager } from "../managers/base-manager";
import type { OpenclawPathPattern } from "./__generated__/route-table";
import { getOrCreateManager } from "../client-infra/manager-registry";

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

export interface ICreateConnectionRequest {
    name: string;
    provider: string;
    base_url: string;
    api_key?: string;
    config?: Record<string, unknown>;
    is_default?: boolean;
}

export interface IUpdateConnectionRequest {
    name?: string;
    base_url?: string;
    api_key?: string;
    config?: Record<string, unknown>;
    is_default?: boolean;
    is_active?: boolean;
}

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

export interface ICreateConversationRequest {
    connection_id?: number;
    title?: string;
    model_id?: string;
    system_prompt?: string;
    temperature?: number;
    max_tokens?: number;
}

export interface IUpdateConversationRequest {
    title?: string;
    system_prompt?: string;
    temperature?: number;
    max_tokens?: number;
    is_pinned?: boolean;
}

export interface IOpenClawMessage {
    id: number;
    conversation_id: number;
    role: string;
    content: string;
    token_count?: number;
    tool_calls?: Record<string, unknown>;
    created_ts: number;
}

export interface ISendMessageRequest {
    content: string;
    role?: string;
    tool_calls?: Record<string, unknown>;
    tool_call_id?: string;
}

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

export interface ICreateChatRoleRequest {
    name: string;
    description?: string;
    system_message: string;
    model_id?: string;
    avatar_url?: string;
    category?: string;
    temperature?: number;
    max_tokens?: number;
    is_public?: boolean;
}

export interface IUpdateChatRoleRequest {
    name?: string;
    description?: string;
    system_message: string;
    model_id?: string;
    avatar_url?: string;
    category?: string;
    temperature?: number;
    max_tokens?: number;
    is_public?: boolean;
}

export interface IOpenClawGeneration {
    id: number;
    conversation_id: number;
    connection_id: number;
    model_id: string;
    prompt: string;
    response: string;
    usage?: Record<string, unknown>;
    created_ts: number;
}

export interface ICreateGenerationRequest {
    conversation_id: number;
    model_id: string;
    prompt: string;
    system_prompt?: string;
    temperature?: number;
}

type StripUnstable<P extends string> = P extends `/_matrix/client/unstable${infer Rest}` ? Rest : never;

function op<P extends StripUnstable<OpenclawPathPattern>>(path: P): P {
    return path;
}

export class OpenClawManager extends BaseManager<any, any> {
    constructor(client: MatrixClient) {
        super(client);
    }

    private async unstableRequest<T>(
        method: Method,
        path: string,
        queryParams?: Record<string, string>,
        body?: any,
    ): Promise<T> {
        return await this.client.http.authedRequest<T>(method, path, queryParams, body, {
            prefix: ClientPrefix.Unstable,
        });
    }

    // Connections
    public async listConnections(): Promise<IOpenClawConnection[]> {
        return this.unstableRequest(Method.Get, op("/org.synapse_rust.openclaw/connections"));
    }

    public async createConnection(request: ICreateConnectionRequest): Promise<IOpenClawConnection> {
        return this.unstableRequest(Method.Post, op("/org.synapse_rust.openclaw/connections"), undefined, request);
    }

    public async getConnection(id: number): Promise<IOpenClawConnection> {
        return this.unstableRequest(
            Method.Get,
            op(`/org.synapse_rust.openclaw/connections/${encodeURIComponent(id)}` as StripUnstable<OpenclawPathPattern>),
        );
    }

    public async updateConnection(id: number, request: IUpdateConnectionRequest): Promise<IOpenClawConnection> {
        return this.unstableRequest(
            Method.Put,
            op(`/org.synapse_rust.openclaw/connections/${encodeURIComponent(id)}` as StripUnstable<OpenclawPathPattern>),
            undefined,
            request,
        );
    }

    public async deleteConnection(id: number): Promise<void> {
        return this.unstableRequest(
            Method.Delete,
            op(`/org.synapse_rust.openclaw/connections/${encodeURIComponent(id)}` as StripUnstable<OpenclawPathPattern>),
        );
    }

    public async testConnection(id: number): Promise<{ success: boolean; error?: string }> {
        return this.unstableRequest(
            Method.Post,
            op(`/org.synapse_rust.openclaw/connections/${encodeURIComponent(id)}/test` as StripUnstable<OpenclawPathPattern>),
        );
    }

    // Conversations
    public async listConversations(): Promise<IOpenClawConversation[]> {
        return this.unstableRequest(Method.Get, op("/org.synapse_rust.openclaw/conversations"));
    }

    public async createConversation(request: ICreateConversationRequest): Promise<IOpenClawConversation> {
        return this.unstableRequest(Method.Post, op("/org.synapse_rust.openclaw/conversations"), undefined, request);
    }

    public async getConversation(id: number): Promise<IOpenClawConversation> {
        return this.unstableRequest(
            Method.Get,
            op(`/org.synapse_rust.openclaw/conversations/${encodeURIComponent(id)}` as StripUnstable<OpenclawPathPattern>),
        );
    }

    public async updateConversation(id: number, request: IUpdateConversationRequest): Promise<IOpenClawConversation> {
        return this.unstableRequest(
            Method.Put,
            op(`/org.synapse_rust.openclaw/conversations/${encodeURIComponent(id)}` as StripUnstable<OpenclawPathPattern>),
            undefined,
            request,
        );
    }

    public async deleteConversation(id: number): Promise<void> {
        return this.unstableRequest(
            Method.Delete,
            op(`/org.synapse_rust.openclaw/conversations/${encodeURIComponent(id)}` as StripUnstable<OpenclawPathPattern>),
        );
    }

    // Messages
    public async listMessages(conversationId: number): Promise<IOpenClawMessage[]> {
        return this.unstableRequest(
            Method.Get,
            op(`/org.synapse_rust.openclaw/conversations/${encodeURIComponent(conversationId)}/messages` as StripUnstable<OpenclawPathPattern>),
        );
    }

    public async sendMessage(conversationId: number, request: ISendMessageRequest): Promise<IOpenClawMessage> {
        return this.unstableRequest(
            Method.Post,
            op(`/org.synapse_rust.openclaw/conversations/${encodeURIComponent(conversationId)}/messages` as StripUnstable<OpenclawPathPattern>),
            undefined,
            request,
        );
    }

    public async deleteMessage(id: number): Promise<void> {
        return this.unstableRequest(
            Method.Delete,
            op(`/org.synapse_rust.openclaw/messages/${encodeURIComponent(id)}` as StripUnstable<OpenclawPathPattern>),
        );
    }

    // Generations
    public async listGenerations(): Promise<IOpenClawGeneration[]> {
        return this.unstableRequest(Method.Get, op("/org.synapse_rust.openclaw/generations"));
    }

    public async createGeneration(request: ICreateGenerationRequest): Promise<IOpenClawGeneration> {
        return this.unstableRequest(Method.Post, op("/org.synapse_rust.openclaw/generations"), undefined, request);
    }

    public async getGeneration(id: number): Promise<IOpenClawGeneration> {
        return this.unstableRequest(
            Method.Get,
            op(`/org.synapse_rust.openclaw/generations/${encodeURIComponent(id)}` as StripUnstable<OpenclawPathPattern>),
        );
    }

    public async deleteGeneration(id: number): Promise<void> {
        return this.unstableRequest(
            Method.Delete,
            op(`/org.synapse_rust.openclaw/generations/${encodeURIComponent(id)}` as StripUnstable<OpenclawPathPattern>),
        );
    }

    // Roles
    public async listRoles(): Promise<IOpenClawChatRole[]> {
        return this.unstableRequest(Method.Get, op("/org.synapse_rust.openclaw/roles"));
    }

    public async createRole(request: ICreateChatRoleRequest): Promise<IOpenClawChatRole> {
        return this.unstableRequest(Method.Post, op("/org.synapse_rust.openclaw/roles"), undefined, request);
    }

    public async getRole(id: number): Promise<IOpenClawChatRole> {
        return this.unstableRequest(
            Method.Get,
            op(`/org.synapse_rust.openclaw/roles/${encodeURIComponent(id)}` as StripUnstable<OpenclawPathPattern>),
        );
    }

    public async updateRole(id: number, request: IUpdateChatRoleRequest): Promise<IOpenClawChatRole> {
        return this.unstableRequest(
            Method.Put,
            op(`/org.synapse_rust.openclaw/roles/${encodeURIComponent(id)}` as StripUnstable<OpenclawPathPattern>),
            undefined,
            request,
        );
    }

    public async deleteRole(id: number): Promise<void> {
        return this.unstableRequest(
            Method.Delete,
            op(`/org.synapse_rust.openclaw/roles/${encodeURIComponent(id)}` as StripUnstable<OpenclawPathPattern>),
        );
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getOpenClawManager(): OpenClawManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getOpenClawManager = function (): OpenClawManager {
        return getOrCreateManager(this, "openclaw", () => new OpenClawManager(this));
    };
}

export default OpenClawManager;
