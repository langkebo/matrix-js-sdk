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
 * Device Trust Manager - 设备信任管理
 *
 * 提供设备验证、信任状态查询、安全摘要等功能
 * 对应后端: synapse-rust/src/web/routes/e2ee_routes.rs
 *
 * 后端端点:
 * - POST /v3/device_verification/request
 * - POST /v3/device_verification/respond
 * - GET /v3/device_verification/status/{token}
 * - GET /v3/device_trust
 * - GET /v3/device_trust/{device_id}
 * - GET /v3/security/summary
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { InvalidParamError } from "../common/errors";
import { LRUCache } from "../utils/lru-cache";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export enum DeviceTrustEvent {
    VerificationRequested = "VerificationRequested",
    VerificationResponded = "VerificationResponded",
    TrustChanged = "TrustChanged",
    SecuritySummaryUpdated = "SecuritySummaryUpdated",
}

/**
 * Device trust levels, mirroring `synapse-e2ee/src/device_trust/models.rs`
 * `DeviceTrustLevel` (`Display` impl at `models.rs:26-29`).
 *
 * Only these three values ever appear on the wire: `verified`, `unverified`,
 * `blocked`. The previous union included `cross_signed` and `blacklisted`,
 * which the backend cannot emit — `isDeviceBlocked()` therefore never matched
 * and always reported `false`.
 */
export type TrustLevel = "verified" | "unverified" | "blocked";

export type VerificationStatus = "pending" | "approved" | "rejected" | "expired" | "not_found";

export type VerificationMethod = "sas" | "qr" | "emoji";

export interface IDeviceVerificationRequest {
    new_device_id?: string;
    device_id?: string;
    method?: VerificationMethod;
}

/**
 * Response of `POST /device_verification/request`.
 *
 * Contract source: `synapse-web/src/routes/e2ee/devices.rs::request_device_verification`
 * → `{ request_token, token, status, expires_at, methods_available }`
 * (`token` is an alias of `request_token`).
 */
export interface IDeviceVerificationResponse {
    request_token: string;
    token: string;
    status: VerificationStatus;
    expires_at: number;
    methods_available: VerificationMethod[];
}

/**
 * Response of `GET /device_verification/status/{token}`.
 *
 * Contract source: `devices.rs::get_verification_status` — returns the same
 * fields as the request response, **or** `{ "status": "not_found" }` with HTTP
 * 200 when the token is unknown (it never 404s). Hence every field except
 * `status` is optional here.
 */
export interface IVerificationStatusResponse {
    request_token?: string;
    token?: string;
    status: VerificationStatus;
    expires_at?: number;
    methods_available?: VerificationMethod[];
}

/**
 * Response of `POST /device_verification/respond`.
 *
 * Contract source: `devices.rs::respond_device_verification` →
 * `{ success, trust_level }`. The request body must carry
 * `request_token` (or its `token` alias) **and `approved: boolean`** —
 * `approved` defaults to `false`, so omitting it silently turns an "accept"
 * into a "reject".
 */
export interface IVerificationRespondResult {
    success: boolean;
    trust_level: TrustLevel;
}

/**
 * One device's trust record.
 *
 * Contract source: `synapse-web/src/routes/e2ee/devices.rs::get_device_trust_list`
 * and `::get_device_trust` → `{ device_id, trust_level, verified_at, verified_by }`.
 *
 * The backend does **not** return `user_id`, `display_name`, `last_seen_ts` or
 * `last_seen_ip` here — those live on `GET /devices` and `POST /keys/query`.
 * Filtering this list by `user_id` (as `CryptoDeviceAdapter.getDevices` used to)
 * therefore always yields an empty result.
 */
export interface IDeviceTrustInfo {
    device_id: string;
    trust_level: TrustLevel;
    verified_at?: number;
    verified_by?: string;
}

export interface IDeviceTrustListResponse {
    devices: IDeviceTrustInfo[];
}

/**
 * Response of `GET /security/summary`.
 *
 * Contract source: `devices.rs::get_security_summary` →
 * `{ verified_devices, unverified_devices, blocked_devices,
 *    has_cross_signing_master, security_score, recommendations }`.
 *
 * NOTE: the field names are *not* the `devices_total` / `devices_verified` /
 * `devices_unverified` / `cross_signing_ready` set that used to be declared
 * here and in `device-keys`/`e2ee`; those names never existed on the wire.
 */
export interface ISecuritySummary {
    verified_devices: number;
    unverified_devices: number;
    blocked_devices: number;
    has_cross_signing_master: boolean;
    security_score: number;
    recommendations: string[];
}
interface DeviceTrustManagerEventMap {
    [DeviceTrustEvent.VerificationRequested]: (response: IDeviceVerificationResponse) => void;
    [DeviceTrustEvent.VerificationResponded]: (result: IVerificationRespondResult) => void;
    [DeviceTrustEvent.TrustChanged]: (deviceId: string, trustLevel: TrustLevel) => void;
    [DeviceTrustEvent.SecuritySummaryUpdated]: (summary: ISecuritySummary) => void;
}

export class DeviceTrustManager extends BaseManager<DeviceTrustEvent, DeviceTrustManagerEventMap> {
    private deviceTrustCache: LRUCache<IDeviceTrustInfo>;
    private deviceTrustListCache: IDeviceTrustInfo[] | null = null;
    private deviceTrustListCacheAt = 0;
    private readonly cacheTTL = 5 * 60 * 1000;
    private securitySummaryCache: LRUCache<ISecuritySummary>;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
        this.deviceTrustCache = new LRUCache<IDeviceTrustInfo>({
            maxSize: 200,
            ttl: 5 * 60 * 1000,
            name: "index.ts-idevicetrustinfo",
        });
        this.securitySummaryCache = new LRUCache<ISecuritySummary>(1, 60 * 1000);
    }

    async requestVerification(request: IDeviceVerificationRequest): Promise<IDeviceVerificationResponse> {
        try {
            const response = await this.withRetry(async () => {
                return await this.request<IDeviceVerificationResponse>({
                    method: Method.Post,
                    path: "/device_verification/request",
                    body: {
                        new_device_id: request.new_device_id,
                        device_id: request.device_id,
                        method: request.method ?? "sas",
                    },
                    prefix: ClientPrefix.V3,
                });
            }, "requestVerification");

            this.emit(DeviceTrustEvent.VerificationRequested, response);
            return response;
        } catch (error) {
            throw this.normalizeError(error, "requestVerification");
        }
    }

    async respondToVerification(token: string, approved: boolean): Promise<IVerificationRespondResult> {
        try {
            const response = await this.withRetry(async () => {
                return await this.request<IVerificationRespondResult>({
                    method: Method.Post,
                    path: "/device_verification/respond",
                    body: {
                        token,
                        approved,
                    },
                    prefix: ClientPrefix.V3,
                });
            }, "respondToVerification");

            this.emit(DeviceTrustEvent.VerificationResponded, response);
            return response;
        } catch (error) {
            throw this.normalizeError(error, "respondToVerification");
        }
    }

    async getVerificationStatus(token: string): Promise<IVerificationStatusResponse> {
        try {
            const response = await this.withRetry(async () => {
                return await this.request<IVerificationStatusResponse>({
                    method: Method.Get,
                    path: `/device_verification/status/${encodeURIComponent(token)}`,
                    prefix: ClientPrefix.V3,
                });
            }, "getVerificationStatus");

            return response;
        } catch (error) {
            throw this.normalizeError(error, "getVerificationStatus");
        }
    }

    async getDeviceTrustList(forceRefresh = false): Promise<IDeviceTrustInfo[]> {
        if (!forceRefresh && this.deviceTrustListCache && Date.now() - this.deviceTrustListCacheAt < this.cacheTTL) {
            return this.deviceTrustListCache;
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.request<IDeviceTrustListResponse>({
                    method: Method.Get,
                    path: "/device_trust",
                    prefix: ClientPrefix.V3,
                });
            }, "getDeviceTrustList");

            const devices = response.devices || [];
            devices.forEach((device) => {
                this.deviceTrustCache.set(device.device_id, device);
            });
            this.deviceTrustListCache = devices;
            this.deviceTrustListCacheAt = Date.now();

            return devices;
        } catch (error) {
            throw this.normalizeError(error, "getDeviceTrustList");
        }
    }

    async getDeviceTrust(deviceId: string, forceRefresh = false): Promise<IDeviceTrustInfo | null> {
        if (!deviceId) {
            throw new InvalidParamError("Device ID is required");
        }

        if (!forceRefresh) {
            const cached = this.deviceTrustCache.get(deviceId);
            if (cached) {
                return cached;
            }
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.request<IDeviceTrustInfo>({
                    method: Method.Get,
                    path: `/device_trust/${encodeURIComponent(deviceId)}`,
                    prefix: ClientPrefix.V3,
                });
            }, "getDeviceTrust");

            this.deviceTrustCache.set(deviceId, response);
            return response;
            // @swallow-error { owner: "crypto-rtc", expires: "2026-12-31" }
        } catch (error) {
            const httpStatus = (error as { httpStatus?: number })?.httpStatus;
            const errcode = (error as { errcode?: string })?.errcode;

            if (httpStatus === 404 || errcode === "M_NOT_FOUND") {
                return null;
            }
            throw this.normalizeError(error, "getDeviceTrust");
        }
    }

    async getSecuritySummary(forceRefresh = false): Promise<ISecuritySummary> {
        if (!forceRefresh) {
            const cached = this.securitySummaryCache.get("__summary__");
            if (cached) {
                return cached;
            }
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.request<ISecuritySummary>({
                    method: Method.Get,
                    path: "/security/summary",
                    prefix: ClientPrefix.V3,
                });
            }, "getSecuritySummary");

            this.securitySummaryCache.set("__summary__", response);
            this.emit(DeviceTrustEvent.SecuritySummaryUpdated, response);
            return response;
        } catch (error) {
            throw this.normalizeError(error, "getSecuritySummary");
        }
    }

    async isDeviceTrusted(deviceId: string): Promise<boolean> {
        const trustInfo = await this.getDeviceTrust(deviceId);
        if (!trustInfo) {
            return false;
        }
        // `cross_signed` is not a wire value: the backend only emits
        // verified / unverified / blocked (models.rs:26-29).
        return trustInfo.trust_level === "verified";
    }

    async isDeviceBlocked(deviceId: string): Promise<boolean> {
        const trustInfo = await this.getDeviceTrust(deviceId);
        if (!trustInfo) {
            return false;
        }
        // Was `=== "blacklisted"`, which the backend never emits (the level is
        // spelled `blocked`), so this always returned false.
        return trustInfo.trust_level === "blocked";
    }

    clearCache(): void {
        this.deviceTrustCache.clear();
        this.deviceTrustListCache = null;
        this.deviceTrustListCacheAt = 0;
        this.securitySummaryCache.clear();
    }

    getCacheStats(): {
        deviceTrust: { size: number; hits: number; misses: number; hitRate: number };
        securitySummary: { size: number; hits: number; misses: number; hitRate: number };
    } {
        return {
            deviceTrust: this.deviceTrustCache.getStats(),
            securitySummary: this.securitySummaryCache.getStats(),
        };
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getDeviceTrustManager = function (): DeviceTrustManager {
        registerManagerClass("deviceTrust", DeviceTrustManager);
        return getOrCreateManager(this, "deviceTrust", () => new DeviceTrustManager(this));
    };
}
