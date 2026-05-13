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
import { InvalidParamError } from "../common/errors";
import { BaseManager } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface KeyRotationStatus {
    current_key_id: string;
    rotation_period_ms: number;
    last_rotation_ts: number;
    next_rotation_ts: number;
    auto_rotation_enabled: boolean;
}

export interface RotateKeyRequest {
    reason?: string;
}

export interface RotateKeyResponse {
    new_key_id: string;
    rotated_at: number;
}

export interface KeyRotationHistoryEntry {
    key_id: string;
    rotated_at: number;
    reason: string;
    previous_key_id?: string;
}

export interface KeyRotationHistory {
    rotations: KeyRotationHistoryEntry[];
    next_batch?: string;
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
    revoked: boolean;
    revoked_at: number;
}

export interface UpdateRotationConfigRequest {
    auto_rotation_enabled: boolean;
    rotation_period_ms: number;
}

export interface UpdateRotationConfigResponse {
    updated: boolean;
}

export interface KeyCheckResponse {
    valid: boolean;
    revoked: boolean;
    expires_at?: number;
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

        try {
            const result = await this.client.http.authedRequest<KeyRotationStatus>(
                Method.Get,
                "/keys/rotation/status",
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );

            this.statusCache = {
                value: result,
                expiresAt: Date.now() + this.statusCacheTtlMs,
            };

            return result;
        } catch (error) {
            throw this.normalizeError(error, "getStatus");
        }
    }

    public async rotateKey(request: RotateKeyRequest = {}): Promise<RotateKeyResponse> {
        if (request.reason !== undefined) {
            this.requireNonEmptyString(request.reason, "reason");
        }

        try {
            const result = await this.client.http.authedRequest<RotateKeyResponse>(
                Method.Post,
                "/keys/rotation/rotate",
                undefined,
                request,
                { prefix: ClientPrefix.V1 },
            );

            this.clearStatusCache();
            return result;
        } catch (error) {
            throw this.normalizeError(error, "rotateKey");
        }
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

        try {
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
        } catch (error) {
            throw this.normalizeError(error, "getRotationHistory");
        }
    }

    public async revokeKey(request: RevokeKeyRequest): Promise<RevokeKeyResponse> {
        this.requireNonEmptyString(request.key_id, "key_id");
        if (request.reason !== undefined) {
            this.requireNonEmptyString(request.reason, "reason");
        }

        try {
            const result = await this.client.http.authedRequest<RevokeKeyResponse>(
                Method.Post,
                "/keys/rotation/revoke",
                undefined,
                request,
                { prefix: ClientPrefix.V1 },
            );

            this.clearStatusCache();
            return result;
        } catch (error) {
            throw this.normalizeError(error, "revokeKey");
        }
    }

    public async updateConfig(request: UpdateRotationConfigRequest): Promise<UpdateRotationConfigResponse> {
        if (typeof request.auto_rotation_enabled !== "boolean") {
            throw new InvalidParamError("auto_rotation_enabled must be a boolean");
        }
        if (!Number.isInteger(request.rotation_period_ms) || request.rotation_period_ms <= 0) {
            throw new InvalidParamError("rotation_period_ms must be a positive integer");
        }

        try {
            const result = await this.client.http.authedRequest<UpdateRotationConfigResponse>(
                Method.Put,
                "/keys/rotation/config",
                undefined,
                request,
                { prefix: ClientPrefix.V1 },
            );

            this.clearStatusCache();
            return result;
        } catch (error) {
            throw this.normalizeError(error, "updateConfig");
        }
    }

    public async checkKeyValidity(keyId: string): Promise<KeyCheckResponse> {
        this.requireNonEmptyString(keyId, "keyId");

        try {
            return await this.client.http.authedRequest<KeyCheckResponse>(
                Method.Get,
                "/keys/rotation/check",
                { key_id: keyId },
                undefined,
                { prefix: ClientPrefix.V1 },
            );
        } catch (error) {
            throw this.normalizeError(error, "checkKeyValidity");
        }
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
