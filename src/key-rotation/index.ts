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
 * Key Rotation Manager - 密钥轮换管理 API 封装
 *
 * 提供加密密钥轮换状态查询、手动轮换、轮换历史、密钥吊销、配置更新等功能
 * 对接后端: synapse-rust/src/web/routes/key_rotation.rs
 * API 前缀: /_matrix/client/v1/keys/rotation
 *
 * 使用方式:
 * ```typescript
 * const manager = client.getKeyRotationManager();
 * // 获取轮换状态
 * const status = await manager.getStatus();
 * // 手动轮换密钥
 * const result = await manager.rotateKey({ key_id: "key-v1" });
 * // 吊销密钥
 * await manager.revokeKey({ key_id: "key-1" });
 * ```
 */
import { MatrixClient } from "../client";
import { InvalidParamError } from "../common/errors";
import { BaseManager } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface KeyRotationStatus {
    enabled: boolean;
    status: Record<string, unknown>;
    user_last_rotation: number | null;
}

export interface RotateKeyRequest {
    key_id?: string;
}

export interface RotateKeyResponse {
    success: boolean;
    message: string;
    has_new_key: boolean;
}

export interface KeyRotationHistoryEntry {
    key_id: string | null;
    rotated_ts: number | null;
}

export interface KeyRotationHistory {
    device_id: string;
    rotations: KeyRotationHistoryEntry[];
}

export interface GetRotationHistoryOptions {
    limit?: number;
    from?: string;
}

export interface RevokeKeyRequest {
    key_id: string;
    reason?: string;
}

export interface RevokeKeyResponse {
    success: boolean;
    revoked: number;
    message: string;
}

export interface UpdateRotationConfigRequest {
    enabled?: boolean;
    interval_ms?: number;
}

export interface UpdateRotationConfigResponse {
    enabled: boolean;
    interval_ms: number;
}

export interface KeyCheckResponse {
    needs_rotation: boolean;
    last_rotation: number | null;
    interval_ms: number;
}

interface StatusCacheEntry {
    value: KeyRotationStatus;
    expiresAt: number;
}

export class KeyRotationManager extends BaseManager {
    private readonly statusCacheTtlMs = 30_000;
    private statusCache: StatusCacheEntry | null = null;

    public constructor(client: MatrixClient) {
        super(client);
    }

    public async getStatus(forceRefresh = false): Promise<KeyRotationStatus> {
        if (!forceRefresh && this.statusCache && this.statusCache.expiresAt > Date.now()) {
            return this.statusCache.value;
        }

        const result = await this.withRetry(async () => {
            return await this.client.http.authedRequest<KeyRotationStatus>(
                Method.Get,
                "/keys/rotation/status",
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );
        }, "getStatus");

        this.statusCache = {
            value: result,
            expiresAt: Date.now() + this.statusCacheTtlMs,
        };

        return result;
    }

    public async rotateKey(request: RotateKeyRequest = {}): Promise<RotateKeyResponse> {
        if (request.key_id !== undefined) {
            this.requireNonEmptyString(request.key_id, "key_id");
        }

        const result = await this.withRetry(async () => {
            return await this.client.http.authedRequest<RotateKeyResponse>(
                Method.Post,
                "/keys/rotation/rotate",
                undefined,
                request,
                { prefix: ClientPrefix.V1 },
            );
        }, "rotateKey");

        this.clearStatusCache();
        return result;
    }

    public async getRotationHistory(
        deviceId: string,
        options: GetRotationHistoryOptions = {},
    ): Promise<KeyRotationHistory> {
        this.requireNonEmptyString(deviceId, "deviceId");

        if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit <= 0)) {
            throw new InvalidParamError("limit must be a positive integer");
        }
        if (options.from !== undefined) {
            this.requireNonEmptyString(options.from, "from");
        }

        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<KeyRotationHistory>(
                Method.Get,
                `/keys/rotation/history/${encodeURIComponent(deviceId)}`,
                {
                    limit: options.limit,
                    from: options.from,
                },
                undefined,
                { prefix: ClientPrefix.V1 },
            );
        }, "getRotationHistory");
    }

    public async revokeKey(request: RevokeKeyRequest): Promise<RevokeKeyResponse> {
        this.requireNonEmptyString(request.key_id, "key_id");
        if (request.reason !== undefined) {
            this.requireNonEmptyString(request.reason, "reason");
        }

        const result = await this.withRetry(async () => {
            return await this.client.http.authedRequest<RevokeKeyResponse>(
                Method.Post,
                "/keys/rotation/revoke",
                undefined,
                request,
                { prefix: ClientPrefix.V1 },
            );
        }, "revokeKey");

        this.clearStatusCache();
        return result;
    }

    public async updateConfig(request: UpdateRotationConfigRequest): Promise<UpdateRotationConfigResponse> {
        if (request.enabled !== undefined && typeof request.enabled !== "boolean") {
            throw new InvalidParamError("enabled must be a boolean");
        }
        if (request.interval_ms !== undefined && (!Number.isInteger(request.interval_ms) || request.interval_ms <= 0)) {
            throw new InvalidParamError("interval_ms must be a positive integer");
        }

        const result = await this.withRetry(async () => {
            return await this.client.http.authedRequest<UpdateRotationConfigResponse>(
                Method.Put,
                "/keys/rotation/config",
                undefined,
                request,
                { prefix: ClientPrefix.V1 },
            );
        }, "updateConfig");

        this.clearStatusCache();
        return result;
    }

    public async checkKeyValidity(keyId: string): Promise<KeyCheckResponse> {
        this.requireNonEmptyString(keyId, "keyId");

        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<KeyCheckResponse>(
                Method.Get,
                "/keys/rotation/check",
                { key_id: keyId },
                undefined,
                { prefix: ClientPrefix.V1 },
            );
        }, "checkKeyValidity");
    }

    public clearStatusCache(): void {
        this.statusCache = null;
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getKeyRotationManager(): KeyRotationManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getKeyRotationManager = function (): KeyRotationManager {
        return getOrCreateManager(this, "keyRotation", () => new KeyRotationManager(this));
    };
}

export default extendMatrixClient;
