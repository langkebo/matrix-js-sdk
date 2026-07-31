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
 * Federation Manager - 联邦管理（门面）
 *
 * 本文件已拆分为 4 个 sub-manager，调用方应直接使用 sub-manager：
 * - `fed.blacklist.*`：黑名单 CRUD
 * - `fed.server.*`：服务器状态/连接
 * - `fed.query.*`：联邦查询
 * - `fed.room.*`：联邦房间/事件/状态
 *
 * FederationManager 仅保留未迁移方法（claimKeys/queryKeys 等）及生命周期管理。
 *
 * ## 后端对齐说明（synapse-rust v10，2026-06）
 *
 * - **C-1 X-Matrix 时间戳校验**: 后端已实现 ±30s 滑动窗口 + nonce 缓存校验。
 *   当通过本 manager 代理 federation 请求时，后端会自动处理 `X-Matrix-Origin` /
 *   `X-Matrix-Timestamp` 请求头，SDK 客户端无需额外设置。
 *
 * - **C-2 Canonical JSON 修复**: 后端已修复 U+2028 (行分隔符) / U+2029 (段落分隔符) /
 *   U+FFFD (替换字符) 的转义处理。SDK 端 JSON 序列化保持不变。
 *
 * - **M_SERVER_NOT_TRUSTED**: 当目标服务器不在信任列表中时，后端返回此错误
 *   (HTTP 502)。调用方可通过 `MatrixError.isServerNotTrustedError()` 检测。
 */

import { BaseManager, type ManagerOpts, type RequestSpec } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { MatrixClient } from "../client";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { logger } from "../logger";
import { ValidationError } from "../errors";
import { type IEvent } from "../models/event";
import { FederationBlacklistManager, FederationBlacklistEvent } from "./sub-managers/federation-blacklist-manager";
import { FederationServerManager, FederationServerEvent } from "./sub-managers/federation-server-manager";
import { FederationQueryManager, FederationQueryEvent } from "./sub-managers/federation-query-manager";
import { FederationRoomManager, FederationRoomEvent } from "./sub-managers/federation-room-manager";
import type { IBlacklistEntry } from "./sub-managers/federation-blacklist-types";
import type { IFederationServer, IFederationStatus } from "./sub-managers/federation-server-types";

export enum FederationEvent {
    BlacklistUpdated = "BlacklistUpdated",
    ServerAdded = "ServerAdded",
    ServerRemoved = "ServerRemoved",
    FederationError = "FederationError",
}

export type { IBlacklistEntry, IFederationServer, IFederationStatus };

interface FederationManagerEventMap {
    [FederationEvent.BlacklistUpdated]: (blacklist: IBlacklistEntry[]) => void;
    [FederationEvent.ServerAdded]: (serverName: string) => void;
    [FederationEvent.ServerRemoved]: (serverName: string) => void;
    [FederationEvent.FederationError]: (error: Error) => void;
}

export class FederationManager extends BaseManager<FederationEvent, FederationManagerEventMap> {
    public readonly blacklist: FederationBlacklistManager;
    public readonly server: FederationServerManager;
    public readonly query: FederationQueryManager;
    public readonly room: FederationRoomManager;
    private initialized: boolean = false;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
        this.blacklist = new FederationBlacklistManager(client, opts);
        this.server = new FederationServerManager(client, opts);
        this.query = new FederationQueryManager(client, opts);
        this.room = new FederationRoomManager(client, opts);
        this.forwardSubManagerEvents();
    }

    /**
     * 将 4 个 sub-manager 的事件转发到顶层 FederationEvent，保证旧监听者继续工作。
     */
    private forwardSubManagerEvents(): void {
        this.blacklist.on(FederationBlacklistEvent.BlacklistUpdated, (list) =>
            this.emit(FederationEvent.BlacklistUpdated, list),
        );
        this.blacklist.on(FederationBlacklistEvent.BlacklistError, (e) =>
            this.emit(FederationEvent.FederationError, e),
        );
        this.server.on(FederationServerEvent.ServerAdded, (s) => this.emit(FederationEvent.ServerAdded, s));
        this.server.on(FederationServerEvent.ServerRemoved, (s) => this.emit(FederationEvent.ServerRemoved, s));
        this.server.on(FederationServerEvent.FederationError, (e) => this.emit(FederationEvent.FederationError, e));
        this.query.on(FederationQueryEvent.FederationError, (e) => this.emit(FederationEvent.FederationError, e));
        this.room.on(FederationRoomEvent.FederationError, (e) => this.emit(FederationEvent.FederationError, e));
    }

    /**
     * Federation 端点（`/_matrix/federation/v1/*`、`/_synapse/federation/v1/*`）
     * 是 server-to-server 接口，不需要用户 access token。
     *
     * 当 `prefix === ""` 时自动走 `client.http.request`（不带 token）；
     * admin 端点（`prefix === AdminPrefix.V1`）仍走默认的 `authedRequest`。
     *
     * 注意：本类仍保留 claimKeys/queryKeys/uploadKeys/cloneKey/backfillRoom 等
     * 未迁移方法，因此需要保留此 request 覆盖。
     */
    protected async request<T>(spec: RequestSpec): Promise<T> {
        if (spec.prefix === "") {
            return super.request<T>({ ...spec, authenticated: false });
        }
        return super.request<T>(spec);
    }

    // ─── 未迁移方法（保留在 FederationManager） ──────────────────

    /**
     * 申领联邦密钥
     *
     * 对应 POST /_synapse/federation/v1/keys/claim
     *
     * @param body - 申领密钥请求体
     * @returns 申领密钥响应
     *
     * @example
     * ```typescript
     * const result = await manager.claimKeys({
     *   one_time_keys: { "@user:example.com": { "device_id": "signed_curve25519" } },
     * });
     * ```
     *
     * @throws {ValidationError} If body is empty
     * @throws {Error} If the request fails
     */
    async claimKeys(
        body: Record<string, unknown> /* Dynamic: federation key claim body varies by algorithm */,
    ): Promise<unknown> {
        if (!body) {
            throw new ValidationError("Body is required");
        }
        try {
            return await this.request<unknown>({
                method: Method.Post,
                path: "/_synapse/federation/v1/keys/claim",
                body,
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "claimKeys");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 查询联邦密钥
     *
     * 对应 POST /_synapse/federation/v1/keys/query
     *
     * @param body - 查询密钥请求体
     * @returns 查询密钥响应
     *
     * @example
     * ```typescript
     * const result = await manager.queryKeys({
     *   device_keys: { "@user:example.com": ["*"] },
     * });
     * ```
     *
     * @throws {ValidationError} If body is empty
     * @throws {Error} If the request fails
     */
    async queryKeys(
        body: Record<string, unknown> /* Dynamic: federation key query body varies by algorithm */,
    ): Promise<unknown> {
        if (!body) {
            throw new ValidationError("Body is required");
        }
        try {
            return await this.request<unknown>({
                method: Method.Post,
                path: "/_synapse/federation/v1/keys/query",
                body,
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "queryKeys");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 上传联邦密钥
     *
     * 对应 POST /_synapse/federation/v1/keys/upload
     *
     * @param body - 上传密钥请求体
     * @returns 上传密钥响应
     *
     * @example
     * ```typescript
     * const result = await manager.uploadKeys({
     *   device_keys: { user_id: "@user:example.com", device_id: "DEVICE", keys: {} },
     *   one_time_keys: {},
     * });
     * ```
     *
     * @throws {ValidationError} If body is empty
     * @throws {Error} If the request fails
     */
    async uploadKeys(
        body: Record<string, unknown> /* Dynamic: federation key upload body varies by algorithm */,
    ): Promise<unknown> {
        if (!body) {
            throw new ValidationError("Body is required");
        }
        try {
            return await this.request<unknown>({
                method: Method.Post,
                path: "/_synapse/federation/v1/keys/upload",
                body,
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "uploadKeys");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 克隆联邦密钥（v2）
     *
     * 对应 POST /_synapse/federation/v2/key/clone
     *
     * @param body - 克隆密钥请求体
     * @returns 克隆密钥响应
     *
     * @example
     * ```typescript
     * const result = await manager.cloneKey({
     *   server_name: "example.com",
     *   key_id: "ed25519:0",
     * });
     * ```
     *
     * @throws {ValidationError} If body is empty
     * @throws {Error} If the request fails
     */
    async cloneKey(
        body: Record<string, unknown> /* Dynamic: federation key clone body varies by algorithm */,
    ): Promise<unknown> {
        if (!body) {
            throw new ValidationError("Body is required");
        }
        try {
            return await this.request<unknown>({
                method: Method.Post,
                path: "/_synapse/federation/v2/key/clone",
                body,
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "cloneKey");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * Canonical JSON 序列化：将 U+2028（行分隔符）、U+2029（段落分隔符）、
     * U+FFFD（替换字符）转义为对应的 JSON 转义序列，确保与后端 C-2 修复对齐。
     *
     * 注意：在 JSON.stringify 之后替换，避免 replacer 导致的双重转义问题。
     */
    static toCanonicalJson(value: unknown): string {
        return JSON.stringify(value)
            .replace(/\u2028/g, "\\u2028")
            .replace(/\u2029/g, "\\u2029")
            .replace(/\ufffd/g, "\\ufffd");
    }

    /**
     * 发送联邦事件（使用 Canonical JSON 序列化，对齐后端 C-2 修复）
     * 对应 PUT /_matrix/federation/v1/send/{txnId}
     */
    async sendFederationEvent(txnId: string, event: IEvent): Promise<void> {
        if (!txnId) throw new ValidationError("Transaction ID is required");
        if (!event) throw new ValidationError("Event is required");

        const canonicalJson = FederationManager.toCanonicalJson(event);

        try {
            await this.client.http.requestOtherUrl(
                Method.Put,
                `${this.client.baseUrl}/_matrix/federation/v1/send/${encodeURIComponent(txnId)}`,
                canonicalJson,
                {
                    headers: {
                        "Content-Type": "application/json",
                    },
                },
            );
        } catch (e) {
            const error = this.normalizeError(e, "sendFederationEvent");
            this.emit(FederationEvent.FederationError, error);
            throw error;
        }
    }

    // ─── 生命周期 ───────────────────────────────────────────────

    clearCache(): void {
        this.blacklist.clearCache();
        this.server.clearCache();
    }

    async start(): Promise<void> {
        if (this.initialized) return;

        try {
            await this.blacklist.getBlacklist(false);
            this.initialized = true;
        } catch (e) {
            const error = this.normalizeError(e, "start");
            logger.warn("FederationManager.start failed:", error);
        }
    }

    stop(): void {
        this.blacklist.clearCache();
        this.server.clearCache();
        this.initialized = false;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getFederationManager = function (): FederationManager {
        registerManagerClass("federation", FederationManager);
        return getOrCreateManager(this, "federation", () => new FederationManager(this));
    };
}
