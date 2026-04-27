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
 * Rendezvous Manager - 二维码登录会话管理
 *
 * 提供二维码登录会话的创建、更新、消息传递等功能
 * 对应后端: synapse-rust/src/web/routes/rendezvous.rs
 *
 * 后端端点:
 * - POST /_matrix/client/v1/rendezvous - 创建会话
 * - GET /_matrix/client/v1/rendezvous/{session_id} - 获取会话
 * - PUT /_matrix/client/v1/rendezvous/{session_id} - 更新会话
 * - DELETE /_matrix/client/v1/rendezvous/{session_id} - 删除会话
 * - POST /_matrix/client/v1/rendezvous/{session_id}/messages - 发送消息
 * - GET /_matrix/client/v1/rendezvous/{session_id}/messages - 获取消息
 */

import { TypedEventEmitter } from "../models/typed-event-emitter.ts";
import { MatrixClient } from "../client";
import { Method } from "../http-api/method.ts";
import { Body, type IRequestOpts } from "../http-api/interface.ts";
import { MatrixError } from "../http-api/errors.ts";
import { AuthError, NotFoundError, ApiError, SdkError } from "../errors.ts";
import { logger } from "../logger.ts";

const RENDEZVOUS_PREFIX = "/_matrix/client/v1";
const RENDEZVOUS_KEY_HEADER = "X-Matrix-Rendezvous-Key";

export type RendezvousSessionIntent = "login.start" | "login.reciprocate";

export type RendezvousSessionTransport = "http.v1" | "http.v2";

export type RendezvousSessionStatus = "created" | "connected" | "completed" | "expired" | "cancelled";

export interface RendezvousSession {
    session_id: string;
    intent: RendezvousSessionIntent;
    transport: RendezvousSessionTransport;
    transport_data?: Record<string, unknown>;
    status: RendezvousSessionStatus;
    created_ts: number;
    expires_at?: number;
    user_id?: string;
    device_id?: string;
    key?: string;
}

export interface CreateSessionResponse {
    url: string;
    session_id: string;
    key: string;
}

export interface UpdateSessionResponse {
    session_id: string;
    status: RendezvousSessionStatus;
    login_finish?: {
        access_token: string;
        device_id: string;
        user_id: string;
    };
}

export interface RendezvousMessage {
    type: string;
    content: Record<string, unknown>;
}

export interface SendMessageResponse {
    session_id: string;
    message_id: string;
    sent_ts: number;
}

export interface GetMessagesResponse {
    messages: RendezvousMessage[];
}

export enum RendezvousEvent {
    SessionCreated = "SessionCreated",
    SessionUpdated = "SessionUpdated",
    SessionDeleted = "SessionDeleted",
    MessageSent = "MessageSent",
    MessageReceived = "MessageReceived",
}

interface RendezvousManagerEventMap {
    [RendezvousEvent.SessionCreated]: (response: CreateSessionResponse) => void;
    [RendezvousEvent.SessionUpdated]: (response: UpdateSessionResponse) => void;
    [RendezvousEvent.SessionDeleted]: (sessionId: string) => void;
    [RendezvousEvent.MessageSent]: (response: SendMessageResponse) => void;
    [RendezvousEvent.MessageReceived]: (messages: RendezvousMessage[]) => void;
}

export class RendezvousManager extends TypedEventEmitter<RendezvousEvent, RendezvousManagerEventMap> {
    private client: MatrixClient;

    constructor(client: MatrixClient) {
        super();
        this.client = client;
    }

    private buildRequestOpts(sessionKey?: string): IRequestOpts {
        const headers = sessionKey ? { [RENDEZVOUS_KEY_HEADER]: sessionKey } : undefined;
        return {
            prefix: RENDEZVOUS_PREFIX,
            headers,
        };
    }

    private normalizeError(error: unknown, method: string): SdkError {
        const err = error as Error;
        if (error instanceof MatrixError) {
            if (error.httpStatus === 401 || error.errcode === "M_UNKNOWN_TOKEN") {
                return new AuthError(`RendezvousManager.${method} failed: ${err?.message ?? "Unknown error"}`, error);
            }
            if (error.httpStatus === 404 || error.errcode === "M_NOT_FOUND") {
                return new NotFoundError(
                    `RendezvousManager.${method} failed: ${err?.message ?? "Unknown error"}`,
                    error,
                );
            }
            return new ApiError(
                `RendezvousManager.${method} failed: ${err?.message ?? "Unknown error"}`,
                error.errcode ?? "UNKNOWN",
                error.httpStatus ?? 0,
                error,
            );
        }
        return new ApiError(
            `RendezvousManager.${method} failed: ${err?.message ?? String(error)}`,
            "UNKNOWN",
            0,
            error,
        );
    }

    private async rendezvousRequest<T>(
        method: Method,
        path: string,
        queryParams?: Record<string, string>,
        body?: unknown,
        sessionKey?: string,
    ): Promise<T> {
        try {
            return (await this.client.http.authedRequest(
                method,
                path,
                queryParams ?? {},
                body as Body | undefined,
                this.buildRequestOpts(sessionKey),
            )) as Promise<T>;
        } catch (err) {
            throw this.normalizeError(err, "request");
        }
    }

    /**
     * 创建 Rendezvous 会话
     * POST /_matrix/client/v1/rendezvous
     */
    async createSession(options: {
        intent: RendezvousSessionIntent;
        transport: RendezvousSessionTransport;
        transport_data?: Record<string, unknown>;
        expires_in_ms?: number;
    }): Promise<CreateSessionResponse> {
        const response = await this.rendezvousRequest<CreateSessionResponse>(
            Method.Post,
            "/rendezvous",
            undefined,
            options,
        );

        this.emit(RendezvousEvent.SessionCreated, response);
        logger.info(`Rendezvous session created: ${response.session_id}`);
        return response;
    }

    /**
     * 获取 Rendezvous 会话
     * GET /_matrix/client/v1/rendezvous/{session_id}
     */
    async getSession(sessionId: string, sessionKey?: string): Promise<RendezvousSession | null> {
        try {
            return await this.rendezvousRequest<RendezvousSession>(
                Method.Get,
                `/rendezvous/${encodeURIComponent(sessionId)}`,
                undefined,
                undefined,
                sessionKey,
            );
            // @swallow-error { owner: "rendezvous", expires: "2026-12-31" }
        } catch (error) {
            if (error instanceof NotFoundError) {
                return null;
            }
            throw error;
        }
    }

    /**
     * 更新 Rendezvous 会话
     * PUT /_matrix/client/v1/rendezvous/{session_id}
     */
    async updateSession(
        sessionId: string,
        status: RendezvousSessionStatus,
        sessionKey?: string,
    ): Promise<UpdateSessionResponse> {
        const response = await this.rendezvousRequest<UpdateSessionResponse>(
            Method.Put,
            `/rendezvous/${encodeURIComponent(sessionId)}`,
            undefined,
            { status },
            sessionKey,
        );

        this.emit(RendezvousEvent.SessionUpdated, response);

        if (response.login_finish) {
            logger.info(`Rendezvous session ${sessionId} completed with login`);
        }

        return response;
    }

    /**
     * 删除 Rendezvous 会话
     * DELETE /_matrix/client/v1/rendezvous/{session_id}
     */
    async deleteSession(sessionId: string, sessionKey?: string): Promise<void> {
        await this.rendezvousRequest<void>(
            Method.Delete,
            `/rendezvous/${encodeURIComponent(sessionId)}`,
            undefined,
            undefined,
            sessionKey,
        );

        this.emit(RendezvousEvent.SessionDeleted, sessionId);
        logger.info(`Rendezvous session deleted: ${sessionId}`);
    }

    /**
     * 发送消息到 Rendezvous 会话
     * POST /_matrix/client/v1/rendezvous/{session_id}/messages
     */
    async sendMessage(sessionId: string, message: RendezvousMessage, sessionKey?: string): Promise<SendMessageResponse> {
        const response = await this.rendezvousRequest<SendMessageResponse>(
            Method.Post,
            `/rendezvous/${encodeURIComponent(sessionId)}/messages`,
            undefined,
            message,
            sessionKey,
        );

        this.emit(RendezvousEvent.MessageSent, response);
        return response;
    }

    /**
     * 获取 Rendezvous 会话的消息
     * GET /_matrix/client/v1/rendezvous/{session_id}/messages
     */
    async getMessages(sessionId: string, sessionKey?: string): Promise<GetMessagesResponse> {
        const response = await this.rendezvousRequest<GetMessagesResponse>(
            Method.Get,
            `/rendezvous/${encodeURIComponent(sessionId)}/messages`,
            undefined,
            undefined,
            sessionKey,
        );

        if (response.messages?.length > 0) {
            this.emit(RendezvousEvent.MessageReceived, response.messages);
        }

        return response;
    }

    /**
     * 连接到现有会话（辅助方法）
     */
    async connectToSession(sessionId: string, sessionKey?: string): Promise<UpdateSessionResponse> {
        return await this.updateSession(sessionId, "connected", sessionKey);
    }

    /**
     * 完成会话并获取登录凭证（辅助方法）
     */
    async completeSession(sessionId: string, sessionKey?: string): Promise<{
        access_token: string;
        device_id: string;
        user_id: string;
    } | null> {
        const response = await this.updateSession(sessionId, "completed", sessionKey);
        return response.login_finish || null;
    }

    /**
     * 轮询获取消息直到会话完成
     */
    async pollForMessages(
        sessionId: string,
        options?: {
            interval?: number;
            maxAttempts?: number;
            onMessage?: (messages: RendezvousMessage[]) => void;
            sessionKey?: string;
        },
    ): Promise<RendezvousMessage[]> {
        const interval = options?.interval ?? 1000;
        const maxAttempts = options?.maxAttempts ?? 60;
        const sessionKey = options?.sessionKey;
        const allMessages: RendezvousMessage[] = [];

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const session = await this.getSession(sessionId, sessionKey);

            if (!session) {
                throw new Error("Session not found or expired");
            }

            if (session.status === "completed" || session.status === "expired" || session.status === "cancelled") {
                break;
            }

            const response = await this.getMessages(sessionId, sessionKey);

            if (response.messages?.length > 0) {
                allMessages.push(...response.messages);

                if (options?.onMessage) {
                    options.onMessage(response.messages);
                }
            }

            await new Promise((resolve) => setTimeout(resolve, interval));
        }

        return allMessages;
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getRendezvousManager(): RendezvousManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRendezvousManager = function (): RendezvousManager {
        return new RendezvousManager(this);
    };
}

export default extendMatrixClient;
