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
 * API 前缀: /_matrix/client/v1/keys/rotation (与 /_matrix/vendor/v1/keys/rotation)
 *
 * ⚠️ **requires server admin**: 所有 5 个端点均要求调用方为 server admin（`auth_user.is_admin`）。
 *    非管理员调用会返回 403 Forbidden，且 `withRetry` **不会重试** 4xx 错误（仅重试 5xx / 超时）。
 *    建议在调用前检查 `client.getUserId()` 是否为管理员账户。
 *
 * 使用方式:
 * ```typescript
 * const manager = client.getKeyRotationManager();
 * // 获取轮换状态（需 admin）
 * const status = await manager.getStatus();
 * // 手动轮换密钥（需 admin）
 * const result = await manager.rotateKey({ key_id: "key-v1" });
 * // 吊销密钥（需 admin）
 * await manager.revokeKey({ key_id: "key-1" });
 * ```
 */
import { MatrixClient } from "../client";
import { InvalidParamError } from "../common/errors";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { Method } from "../http-api/method";
// ISSUE-13: 私有端点走 vendor 前缀（后端 /_matrix/vendor/v1 与 client 别名并存）
import { VendorPrefix } from "../http-api/prefix";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface KeyRotationStatusResponse {
    current_key_id?: string;
    next_rotation_at?: number;
    rotation_enabled?: boolean;
    [key: string]: unknown;
}

export interface KeyRotationStatus {
    enabled: boolean;
    status: KeyRotationStatusResponse;
    user_last_rotation: number | null;
}

export interface RotateKeyRequest {
    key_id?: string;
}

export interface RotateKeyResponse {
    success: boolean;
    message: string;
    has_new_key: boolean;
    key_id?: string;
    rotated_at?: number;
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

/**
 * Update rotation configuration request.
 *
 * Aligns with backend `key_rotation.rs:140-147` (8 configurable fields).
 * Fields are optional to support partial updates (only changed values need to be sent).
 */
export interface UpdateRotationConfigRequest {
    /** Enable or disable automatic key rotation (boolean) */
    enabled?: boolean;
    /** Rotation interval in milliseconds (positive integer) */
    interval_ms?: number;
    /** Rotation interval in days (positive integer) */
    rotation_interval_days?: number;
    /** Rotation threshold in days (positive integer) */
    rotation_threshold_days?: number;
    /** Grace period in minutes (positive integer) */
    grace_period_minutes?: number;
    /** Olm key rotation interval in days (positive integer) */
    olm_rotation_days?: number;
    /** Megolm key rotation threshold by message count (positive integer) */
    megolm_rotation_messages?: number;
    /** Maximum session age in days (positive integer) */
    max_session_age_days?: number;
}

/**
 * Update rotation configuration response.
 *
 * Returned by the server after applying the configuration; mirrors the 8
 * configurable fields of {@link UpdateRotationConfigRequest} plus the
 * `config_applied` confirmation flag observed in backend responses.
 */
export interface UpdateRotationConfigResponse {
    /** Whether automatic key rotation is enabled */
    enabled: boolean;
    /** Rotation interval in milliseconds */
    interval_ms: number;
    /** Rotation interval in days */
    rotation_interval_days?: number;
    /** Rotation threshold in days */
    rotation_threshold_days?: number;
    /** Grace period in minutes */
    grace_period_minutes?: number;
    /** Olm key rotation interval in days */
    olm_rotation_days?: number;
    /** Megolm key rotation threshold by message count */
    megolm_rotation_messages?: number;
    /** Maximum session age in days */
    max_session_age_days?: number;
    /** Whether the configuration was applied by the server */
    config_applied?: boolean;
}

export interface KeyCheckResponse {
    needs_rotation: boolean;
    last_rotation: number | null;
    interval_ms: number;
}

export interface PostCheckResponse {
    enabled?: boolean;
    interval_ms?: number;
    last_rotation?: number | null;
    needs_rotation?: boolean;
}

interface StatusCacheEntry {
    value: KeyRotationStatus;
    expiresAt: number;
}

export class KeyRotationManager extends BaseManager {
    private readonly statusCacheTtlMs = 30_000;
    private statusCache: StatusCacheEntry | null = null;
    private readonly adminMfaCodeProvider?: () => string;

    public constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
        this.adminMfaCodeProvider = opts?.adminMfaCodeProvider;
    }

    /**
     * 构造 admin 敏感操作所需的请求头。
     *
     * 该 Manager 的全部端点都要求调用方为 server admin；当后端开启
     * `admin_mfa_required` 时，全部 POST/PUT/PATCH/DELETE 都必须携带
     * `x-admin-mfa-code` 头（见 `synapse-web/src/utils/admin_auth.rs::is_sensitive_admin_request`），
     * 否则会被 403 拒绝。配置了 `adminMfaCodeProvider` 时每次请求重新取码，
     * 避免重试时复用已过期的 TOTP；未配置时返回 `undefined`，请求行为不变。
     */
    private adminMfaHeaders(): Record<string, string> | undefined {
        const code = this.adminMfaCodeProvider?.();
        return code ? { "x-admin-mfa-code": code } : undefined;
    }

    /**
     * Get the current encryption key rotation status for the logged-in user.
     *
     * The result is cached for 30 seconds; pass `forceRefresh` to bypass the cache
     * and query the backend again.
     *
     * @param forceRefresh - When `true`, skip the cached status and re-fetch it from the server. Defaults to `false`.
     * @returns The rotation status, including whether rotation is enabled, the raw
     *     server status payload and the timestamp of the user's last rotation.
     *
     * @example
     * ```typescript
     * const manager = client.getKeyRotationManager();
     * const status = await manager.getStatus(true);
     * if (status.enabled) {
     *     console.log(`current key: ${status.status.current_key_id}`);
     *     console.log(`next rotation at: ${status.status.next_rotation_at}`);
     * }
     * ```
     *
     * @throws {ApiError} If the API call fails (including 403 Forbidden for non-admin users).
     */
    public async getStatus(forceRefresh = false): Promise<KeyRotationStatus> {
        if (!forceRefresh && this.statusCache && this.statusCache.expiresAt > Date.now()) {
            return this.statusCache.value;
        }

        const result = await this.withRetry(async () => {
            return await this.request<KeyRotationStatus>({
                method: Method.Get,
                path: "/keys/rotation/status",
                prefix: VendorPrefix,
                headers: this.adminMfaHeaders(),
                label: "getStatus",
            });
        }, "getStatus");

        this.statusCache = {
            value: result,
            expiresAt: Date.now() + this.statusCacheTtlMs,
        };

        return result;
    }

    /**
     * Manually rotate the current encryption key.
     *
     * Clears the cached status so that the next `getStatus` call reflects the new key.
     *
     * @param request - Optional rotation request; `request.key_id` pins the rotation to the
     *     given key. Defaults to an empty object.
     * @returns The rotation result, including whether a new key was created and, when
     *     available, its identifier and rotation timestamp.
     *
     * @example
     * ```typescript
     * const manager = client.getKeyRotationManager();
     * const result = await manager.rotateKey({ key_id: "key-v1" });
     * if (result.has_new_key) {
     *     console.log(`rotated to ${result.key_id} at ${result.rotated_at}`);
     * }
     * ```
     *
     * @throws {ValidationError} If `request.key_id` is provided but empty.
     * @throws {ApiError} If the API call fails.
     */
    public async rotateKey(request: RotateKeyRequest = {}): Promise<RotateKeyResponse> {
        if (request.key_id !== undefined) {
            this.requireNonEmptyString(request.key_id, "key_id");
        }

        const result = await this.withRetry(async () => {
            return await this.request<RotateKeyResponse>({
                method: Method.Post,
                path: "/keys/rotation/rotate",
                body: request,
                prefix: VendorPrefix,
                headers: this.adminMfaHeaders(),
                label: "rotateKey",
            });
        }, "rotateKey");

        this.clearStatusCache();
        return result;
    }

    /**
     * Get the key rotation history for a device.
     *
     * @param deviceId - The device ID whose rotation history should be fetched.
     * @param options - Optional pagination options for the history request.
     * @param options.limit - Maximum number of entries to return; must be a positive integer.
     * @param options.from - Pagination token returned by a previous call.
     * @returns The rotation history for the device.
     *
     * @example
     * ```typescript
     * const manager = client.getKeyRotationManager();
     * const history = await manager.getRotationHistory("DEVICEID", { limit: 10 });
     * for (const entry of history.rotations) {
     *     console.log(`${entry.key_id} rotated at ${entry.rotated_ts}`);
     * }
     * ```
     *
     * @throws {ValidationError} If `deviceId` or `options.from` is empty.
     * @throws {InvalidParamError} If `options.limit` is not a positive integer.
     * @throws {ApiError} If the API call fails.
     */
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
            return await this.request<KeyRotationHistory>({
                method: Method.Get,
                path: `/keys/rotation/history/${encodeURIComponent(deviceId)}`,
                queryParams: {
                    limit: options.limit,
                    from: options.from,
                },
                prefix: VendorPrefix,
                headers: this.adminMfaHeaders(),
                label: "getRotationHistory",
            });
        }, "getRotationHistory");
    }

    /**
     * Revoke an encryption key.
     *
     * Clears the cached status so that the next `getStatus` call reflects the revocation.
     *
     * @param request - The revocation request; `request.reason` optionally records why the
     *     key was revoked.
     * @returns The revocation result, including the number of keys that were revoked.
     *
     * @example
     * ```typescript
     * const manager = client.getKeyRotationManager();
     * const result = await manager.revokeKey({ key_id: "key-1", reason: "compromised" });
     * console.log(`${result.revoked} key(s) revoked: ${result.message}`);
     * ```
     *
     * @throws {ValidationError} If `request.key_id` or `request.reason` is empty.
     * @throws {ApiError} If the API call fails.
     */
    public async revokeKey(request: RevokeKeyRequest): Promise<RevokeKeyResponse> {
        this.requireNonEmptyString(request.key_id, "key_id");
        if (request.reason !== undefined) {
            this.requireNonEmptyString(request.reason, "reason");
        }

        const result = await this.withRetry(async () => {
            return await this.request<RevokeKeyResponse>({
                method: Method.Post,
                path: "/keys/rotation/revoke",
                body: request,
                prefix: VendorPrefix,
                headers: this.adminMfaHeaders(),
                label: "revokeKey",
            });
        }, "revokeKey");

        this.clearStatusCache();
        return result;
    }

    /**
     * Update the key rotation configuration.
     *
     * Clears the cached status so that the next `getStatus` call uses the new configuration.
     *
     * @param request - The configuration to apply. Supports partial updates; only
     *     provided fields are sent to the server. See {@link UpdateRotationConfigRequest}.
     * @returns The configuration as applied by the server.
     *
     * @example
     * ```typescript
     * const manager = client.getKeyRotationManager();
     * const config = await manager.updateConfig({ enabled: true, interval_ms: 86400000 });
     * console.log(`rotation enabled: ${config.enabled}, interval: ${config.interval_ms}ms`);
     * ```
     *
     * @throws {InvalidParamError} If any provided field has an invalid type or range.
     * @throws {ApiError} If the API call fails.
     */
    public async updateConfig(request: UpdateRotationConfigRequest): Promise<UpdateRotationConfigResponse> {
        if (request.enabled !== undefined && typeof request.enabled !== "boolean") {
            throw new InvalidParamError("enabled must be a boolean");
        }
        const positiveIntFields: Array<keyof UpdateRotationConfigRequest> = [
            "interval_ms",
            "rotation_interval_days",
            "rotation_threshold_days",
            "grace_period_minutes",
            "olm_rotation_days",
            "megolm_rotation_messages",
            "max_session_age_days",
        ];
        for (const field of positiveIntFields) {
            const value = request[field];
            if (value !== undefined && (typeof value !== "number" || !Number.isInteger(value) || value <= 0)) {
                throw new InvalidParamError(`${field} must be a positive integer`);
            }
        }

        const result = await this.withRetry(async () => {
            return await this.request<UpdateRotationConfigResponse>({
                method: Method.Put,
                path: "/keys/rotation/config",
                body: request,
                prefix: VendorPrefix,
                headers: this.adminMfaHeaders(),
                label: "updateConfig",
            });
        }, "updateConfig");

        this.clearStatusCache();
        return result;
    }

    /**
     * POST variant of updateConfig.
     * Convenience method that uses POST instead of PUT for the same endpoint.
     */
    public async postConfig(request: UpdateRotationConfigRequest): Promise<UpdateRotationConfigResponse> {
        if (request.enabled !== undefined && typeof request.enabled !== "boolean") {
            throw new InvalidParamError("enabled must be a boolean");
        }
        const positiveIntFields: Array<keyof UpdateRotationConfigRequest> = [
            "interval_ms",
            "rotation_interval_days",
            "rotation_threshold_days",
            "grace_period_minutes",
            "olm_rotation_days",
            "megolm_rotation_messages",
            "max_session_age_days",
        ];
        for (const field of positiveIntFields) {
            const value = request[field];
            if (value !== undefined && (typeof value !== "number" || !Number.isInteger(value) || value <= 0)) {
                throw new InvalidParamError(`${field} must be a positive integer`);
            }
        }

        const result = await this.withRetry(async () => {
            return await this.request<UpdateRotationConfigResponse>({
                method: Method.Post,
                path: "/keys/rotation/config",
                body: request,
                prefix: VendorPrefix,
                headers: this.adminMfaHeaders(),
                label: "postConfig",
            });
        }, "postConfig");

        this.clearStatusCache();
        return result;
    }

    /**
     * POST variant of getStatus.
     * Convenience method that uses POST instead of GET for the same endpoint.
     */
    public async postStatus(): Promise<KeyRotationStatus> {
        const result = await this.withRetry(async () => {
            return await this.request<KeyRotationStatus>({
                method: Method.Post,
                path: "/keys/rotation/status",
                prefix: VendorPrefix,
                headers: this.adminMfaHeaders(),
                label: "postStatus",
            });
        }, "postStatus");

        this.statusCache = {
            value: result,
            expiresAt: Date.now() + this.statusCacheTtlMs,
        };

        return result;
    }

    /**
     * Check whether a key is still valid or needs rotation.
     *
     * @param keyId - The identifier of the key to check.
     * @returns The check result, including whether the key needs rotation, when it was last
     *     rotated and the configured rotation interval.
     *
     * @example
     * ```typescript
     * const manager = client.getKeyRotationManager();
     * const check = await manager.checkKeyValidity("key-v1");
     * if (check.needs_rotation) {
     *     console.log(`key must be rotated (last rotation: ${check.last_rotation})`);
     * }
     * ```
     *
     * @throws {ValidationError} If `keyId` is empty.
     * @throws {ApiError} If the API call fails.
     */
    public async checkKeyValidity(keyId: string): Promise<KeyCheckResponse> {
        this.requireNonEmptyString(keyId, "keyId");

        return await this.withRetry(async () => {
            return await this.request<KeyCheckResponse>({
                method: Method.Get,
                path: "/keys/rotation/check",
                queryParams: { key_id: keyId },
                prefix: VendorPrefix,
                headers: this.adminMfaHeaders(),
                label: "checkKeyValidity",
            });
        }, "checkKeyValidity");
    }

    public async postCheck(): Promise<PostCheckResponse> {
        return await this.withRetry(async () => {
            return await this.request<PostCheckResponse>({
                method: Method.Post,
                path: "/keys/rotation/check",
                prefix: VendorPrefix,
                headers: this.adminMfaHeaders(),
                label: "postCheck",
            });
        }, "postCheck");
    }

    public clearStatusCache(): void {
        this.statusCache = null;
    }
}

export function extendMatrixClient(opts?: ManagerOpts): void {
    MatrixClient.prototype.getKeyRotationManager = function (): KeyRotationManager {
        registerManagerClass("keyRotation", KeyRotationManager);
        return getOrCreateManager(this, "keyRotation", () => new KeyRotationManager(this, opts));
    };
}
