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
import { BaseManager } from "../managers/base-manager";
import { InvalidParamError } from "../common/errors";
import { LRUCache } from "../utils/lru-cache";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export enum DeviceTrustEvent {
    VerificationRequested = "VerificationRequested",
    VerificationResponded = "VerificationResponded",
    TrustChanged = "TrustChanged",
    SecuritySummaryUpdated = "SecuritySummaryUpdated",
}

export type TrustLevel = "verified" | "cross_signed" | "unverified" | "blacklisted";

export type VerificationStatus = "pending" | "approved" | "rejected" | "expired" | "not_found";

export type VerificationMethod = "sas" | "qr" | "emoji";

export interface IDeviceVerificationRequest {
    new_device_id?: string;
    device_id?: string;
    method?: VerificationMethod;
}

export interface IDeviceVerificationResponse {
    request_token: string;
    token: string;
    status: VerificationStatus;
    expires_at: number;
    methods_available: VerificationMethod[];
}

export interface IVerificationRespondResult {
    success: boolean;
    trust_level: TrustLevel;
}

export interface IDeviceTrustInfo {
    device_id: string;
    trust_level: TrustLevel;
    verified_at?: number;
    verified_by?: string;
}

export interface IDeviceTrustListResponse {
    devices: IDeviceTrustInfo[];
}

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

    constructor(client: MatrixClient) {
        super(client);
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
                return await this.client.http.authedRequest<IDeviceVerificationResponse>(
                    Method.Post,
                    "/device_verification/request",
                    undefined,
                    {
                        new_device_id: request.new_device_id,
                        device_id: request.device_id,
                        method: request.method ?? "sas",
                    },
                    { prefix: ClientPrefix.V3 },
                );
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
                return await this.client.http.authedRequest<IVerificationRespondResult>(
                    Method.Post,
                    "/device_verification/respond",
                    undefined,
                    {
                        token,
                        approved,
                    },
                    { prefix: ClientPrefix.V3 },
                );
            }, "respondToVerification");

            this.emit(DeviceTrustEvent.VerificationResponded, response);
            return response;
        } catch (error) {
            throw this.normalizeError(error, "respondToVerification");
        }
    }

    async getVerificationStatus(token: string): Promise<IDeviceVerificationResponse> {
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IDeviceVerificationResponse>(
                    Method.Get,
                    `/device_verification/status/${encodeURIComponent(token)}`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
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
                return await this.client.http.authedRequest<IDeviceTrustListResponse>(
                    Method.Get,
                    "/device_trust",
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
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
                return await this.client.http.authedRequest<IDeviceTrustInfo>(
                    Method.Get,
                    `/device_trust/${encodeURIComponent(deviceId)}`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
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
                return await this.client.http.authedRequest<ISecuritySummary>(
                    Method.Get,
                    "/security/summary",
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
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
        return trustInfo.trust_level === "verified" || trustInfo.trust_level === "cross_signed";
    }

    async isDeviceBlocked(deviceId: string): Promise<boolean> {
        const trustInfo = await this.getDeviceTrust(deviceId);
        if (!trustInfo) {
            return false;
        }
        return trustInfo.trust_level === "blacklisted";
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

export default extendMatrixClient;
