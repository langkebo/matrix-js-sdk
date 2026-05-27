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
 * Device Manager - 设备管理
 *
 * 提供设备查询、更新、删除功能，包括：
 * - 设备列表管理
 * - 设备缓存
 * - 统一错误处理
 * - 性能监控
 *
 * 后端实现: synapse-rust/src/web/routes/device.rs
 */

import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { InvalidParamError } from "../common/errors";
import { logger } from "../logger";
import { MatrixClient } from "../client";
import { MatrixError } from "../http-api/errors";
import { BaseManager } from "../managers/base-manager";
import { NotFoundError, ValidationError } from "../errors";
import { LRUCache } from "../utils/lru-cache";
import type { DevicePathPattern } from "./__generated__/route-table";
import { getOrCreateManager } from "../client-infra/manager-registry";

export enum DeviceEvent {
    DevicesUpdated = "DevicesUpdated",
    DeviceDeleted = "DeviceDeleted",
    DeviceUpdated = "DeviceUpdated",
    DeviceError = "DeviceError",
}

/**
 * 设备信息接口
 *
 * 后端实现: synapse-rust/src/web/routes/device.rs:60-68
 */
export interface IDevice {
    device_id: string;
    display_name?: string;
    last_seen_ip?: string;
    last_seen_ts?: number;
    user_id?: string;
}

export interface IDeviceUpdateRequest {
    display_name?: string;
}

export interface IDeviceDeleteRequest {
    devices: string[];
    auth?: IAuthDict;
}

export interface IAuthDict {
    type: string;
    session?: string;
    [key: string]: unknown;
}

export interface IDeviceList {
    devices: IDevice[];
}

export interface IDeviceListUpdatesRequest {
    users: string[];
}

export interface IDeviceData {
    display_name?: string;
    last_seen_ts?: number;
    last_seen_ip?: string;
}

export interface IDeviceChange {
    user_id: string;
    device_id: string;
    device_data: IDeviceData;
}

/**
 * 设备列表更新响应
 *
 * 后端实现: synapse-rust/src/web/routes/device.rs:174-199
 */
export interface IDeviceListUpdatesResponse {
    changed: IDeviceChange[];
    left: string[];
}

interface DeviceManagerEventMap {
    [DeviceEvent.DevicesUpdated]: (devices: IDevice[]) => void;
    [DeviceEvent.DeviceDeleted]: (deviceId: string) => void;
    [DeviceEvent.DeviceUpdated]: (device: IDevice) => void;
    [DeviceEvent.DeviceError]: (error: Error) => void;
}

interface IUIAErrorData {
    error?: string;
    flows?: unknown[];
    session?: string;
    params?: Record<string, unknown>;
    [key: string]: unknown;
}

export class UIAError extends Error {
    public readonly data: IUIAErrorData;

    constructor(data: IUIAErrorData) {
        super(data.error || "User-Interactive Authentication required");
        this.name = "UIAError";
        this.data = data;
    }
}

function extractUiaErrorData(error: unknown): IUIAErrorData | null {
    const candidates = [error];
    let fallback: IUIAErrorData | null = null;

    if (error && typeof error === "object" && "cause" in error) {
        candidates.push((error as { cause?: unknown }).cause);
    }

    for (const candidate of candidates) {
        if (!candidate || typeof candidate !== "object") {
            continue;
        }

        const record = candidate as Record<string, unknown>;
        if (record.data && typeof record.data === "object") {
            const nestedData = record.data as Record<string, unknown>;
            if (
                "flows" in nestedData ||
                "session" in nestedData ||
                "params" in nestedData ||
                record.errcode === "M_UIA_REQUIRED"
            ) {
                return record.data as IUIAErrorData;
            }
        }

        if ("flows" in record || "session" in record || "params" in record) {
            return record as IUIAErrorData;
        }

        if (record.errcode === "M_UIA_REQUIRED" || record.errorCode === "M_UIA_REQUIRED") {
            fallback ??= {
                error: typeof record.message === "string" ? record.message : "User-Interactive Authentication required",
            };
        }
    }

    return fallback;
}

interface IDevicesResponse {
    devices: IDevice[];
}

interface IDeviceResponse {
    device_id: string;
    display_name?: string;
    last_seen_ip?: string;
    last_seen_ts?: number;
    user_id?: string;
}

type StripV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;

function dp<P extends StripV3<DevicePathPattern>>(path: P): P {
    return path;
}

export class DeviceManager extends BaseManager<DeviceEvent, DeviceManagerEventMap> {
    private deviceListCache: LRUCache<IDevice[]>;
    private deviceCache: LRUCache<IDevice>;
    private currentDeviceId: string | null = null;
    private initialized: boolean = false;

    constructor(client: MatrixClient) {
        super(client);
        this.currentDeviceId = client.deviceId ?? null;

        this.deviceListCache = new LRUCache<IDevice[]>({ maxSize: 10, ttl: 5 * 60 * 1000, name: "index.ts-idevice" });
        this.deviceCache = new LRUCache<IDevice>({ maxSize: 200, ttl: 10 * 60 * 1000, name: "index.ts-idevice" });
    }

    /**
     * 获取所有设备
     *
     * @param forceRefresh - 是否强制刷新缓存（默认 false）
     * @returns 设备列表
     *
     * @example
     * ```typescript
     * // 获取所有设备
     * const devices = await deviceManager.getDevices();
     * devices.forEach(device => {
     *     console.log(`Device: ${device.device_id}`);
     *     console.log(`  Name: ${device.display_name}`);
     *     console.log(`  Last seen: ${device.last_seen_ts}`);
     * });
     *
     * // 强制刷新缓存
     * const freshDevices = await deviceManager.getDevices(true);
     * ```
     *
     * @throws {AuthError} 如果认证失败
     * @throws {ApiError} 如果 API 调用失败
     *
     * 后端实现: synapse-rust/src/web/routes/device.rs:49-74
     */
    async getDevices(forceRefresh = false): Promise<IDevice[]> {
        if (!forceRefresh) {
            const cached = this.deviceListCache.get("devices");
            if (cached) {
                return cached;
            }
        }

        try {
            const result = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IDevicesResponse>(
                    Method.Get,
                    dp("/devices"),
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "getDevices");

            const devices: IDevice[] = result.devices || [];

            this.deviceListCache.set("devices", devices);
            devices.forEach((d) => this.deviceCache.set(d.device_id, d));

            this.emit(DeviceEvent.DevicesUpdated, devices);

            return devices;
        } catch (error) {
            throw this.normalizeError(error, "getDevices");
        }
    }

    /**
     * 获取单个设备
     *
     * @param deviceId - 设备 ID
     * @param forceRefresh - 是否强制刷新
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 设备信息
     *
     * @example
     * ```typescript
     * // 获取设备详情
     * const device = await deviceManager.getDevice("ABCDEFGH");
     * if (device) {
     *     console.log(`Device name: ${device.display_name}`);
     *     console.log(`Last seen: ${new Date(device.last_seen_ts!)}`);
     * }
     *
     * // 不抛出错误
     * const device = await deviceManager.getDevice("INVALID", false, false);
     * if (!device) {
     *     console.log("Device not found");
     * }
     * ```
     *
     * @throws {ValidationError} 如果设备 ID 为空
     * @throws {NotFoundError} 如果设备不存在且 throwOnError 为 true
     * @throws {ApiError} 如果 API 调用失败
     *
     * 后端实现: synapse-rust/src/web/routes/device.rs:77-103
     */
    async getDevice(deviceId: string, forceRefresh = false, throwOnError = true): Promise<IDevice | null> {
        if (!deviceId) {
            throw new ValidationError("Device ID is required");
        }

        if (!forceRefresh) {
            const cached = this.deviceCache.get(deviceId);
            if (cached) {
                return cached;
            }
        }

        try {
            const device = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IDeviceResponse>(
                    Method.Get,
                    dp(`/devices/${encodeURIComponent(deviceId)}`),
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "getDevice");

            const fullDevice: IDevice = {
                device_id: device.device_id,
                display_name: device.display_name,
                last_seen_ip: device.last_seen_ip,
                last_seen_ts: device.last_seen_ts,
                user_id: device.user_id,
            };

            this.deviceCache.set(deviceId, fullDevice);

            return fullDevice;
        } catch (error) {
            const err = this.normalizeError(error, "getDevice");
            if (throwOnError) {
                throw err;
            }
            if (err instanceof NotFoundError) {
                logger.warn(`DeviceManager.getDevice failed for ${deviceId}:`, err);
                return null;
            }
            throw err;
        }
    }

    /**
     * 更新设备
     *
     * 后端实现: synapse-rust/src/web/routes/device.rs:107-131
     */
    async updateDevice(deviceId: string, updates: IDeviceUpdateRequest): Promise<void> {
        if (!deviceId) {
            throw new InvalidParamError("Device ID is required");
        }

        if (!updates || Object.keys(updates).length === 0) {
            throw new InvalidParamError("No updates provided");
        }

        try {
            await this.withRetry(async () => {
                return await this.client.http.authedRequest(
                    Method.Put,
                    dp(`/devices/${encodeURIComponent(deviceId)}`),
                    undefined,
                    updates,
                    { prefix: ClientPrefix.V3 },
                );
            }, "updateDevice");

            const existingDevice = this.deviceCache.get(deviceId);
            if (existingDevice) {
                const updatedDevice: IDevice = {
                    ...existingDevice,
                    ...updates,
                };
                this.deviceCache.set(deviceId, updatedDevice);
                this.emit(DeviceEvent.DeviceUpdated, updatedDevice);
            }

            this.deviceListCache.delete("devices");
        } catch (error) {
            const uiaData = extractUiaErrorData(error);
            if (uiaData) {
                throw new UIAError(uiaData);
            }
            throw this.normalizeError(error, "updateDevice");
        }
    }

    async setDeviceDetails(deviceId: string, updates: IDeviceUpdateRequest): Promise<void> {
        return this.updateDevice(deviceId, updates);
    }

    /**
     * 删除设备
     *
     * @param deviceId - 设备 ID
     * @param authDict - 认证字典（用于 UIA）
     *
     * @example
     * ```typescript
     * // 删除设备
     * try {
     *     await deviceManager.deleteDevice("ABCDEFGH");
     *     console.log("Device deleted successfully");
     * } catch (error) {
     *     if (error instanceof UIAError) {
     *         // 需要用户交互认证
     *         console.log("UIA required:", error.data);
     *         // 提供认证信息后重试
     *         await deviceManager.deleteDevice("ABCDEFGH", {
     *             type: "m.login.password",
     *             session: error.data.session,
     *             user: "@alice:example.com",
     *             password: "password"
     *         });
     *     }
     * }
     * ```
     *
     * @throws {ValidationError} 如果设备 ID 为空
     * @throws {InvalidParamError} 如果尝试删除当前设备
     * @throws {UIAError} 如果需要用户交互认证
     * @throws {ApiError} 如果 API 调用失败
     *
     * 后端实现: synapse-rust/src/web/routes/device.rs:135-153
     */
    async deleteDevice(deviceId: string, authDict?: IAuthDict): Promise<void> {
        if (!deviceId) {
            throw new ValidationError("Device ID is required");
        }

        if (deviceId === this.currentDeviceId) {
            throw new InvalidParamError("Cannot delete the current device");
        }

        try {
            // Some homeservers require DELETE /devices/{id} to carry a JSON body,
            // even before they decide whether UIA is needed.
            const body: { auth?: IAuthDict } = {};
            if (authDict) {
                body.auth = authDict;
            }

            await this.withRetry(async () => {
                return await this.client.http.authedRequest(
                    Method.Delete,
                    dp(`/devices/${encodeURIComponent(deviceId)}`),
                    undefined,
                    body,
                    { prefix: ClientPrefix.V3 },
                );
            }, "deleteDevice");

            this.deviceCache.delete(deviceId);
            this.deviceListCache.delete("devices");
            this.emit(DeviceEvent.DeviceDeleted, deviceId);
        } catch (error) {
            const uiaData = extractUiaErrorData(error);
            if (uiaData) {
                throw new UIAError(uiaData);
            }
            throw this.normalizeError(error, "deleteDevice");
        }
    }

    /**
     * 批量删除设备
     *
     * 后端实现: synapse-rust/src/web/routes/device.rs:157-170
     */
    async deleteDevices(request: string[] | IDeviceDeleteRequest): Promise<void> {
        const devices = Array.isArray(request) ? request : request.devices;

        if (!devices || devices.length === 0) {
            throw new InvalidParamError("No devices to delete");
        }

        if (devices.includes(this.currentDeviceId ?? "")) {
            throw new InvalidParamError("Cannot delete the current device");
        }

        const auth = Array.isArray(request) ? undefined : request.auth;

        try {
            const body: { devices: string[]; auth?: IAuthDict } = {
                devices: devices,
            };
            if (auth) {
                body.auth = auth;
            }

            await this.withRetry(async () => {
                return await this.client.http.authedRequest(Method.Post, dp("/delete_devices"), undefined, body, {
                    prefix: ClientPrefix.V3,
                });
            }, "deleteDevices");

            devices.forEach((deviceId) => {
                this.deviceCache.delete(deviceId);
                this.emit(DeviceEvent.DeviceDeleted, deviceId);
            });

            this.deviceListCache.delete("devices");
        } catch (error) {
            const uiaData = extractUiaErrorData(error);
            if (uiaData) {
                throw new UIAError(uiaData);
            }
            throw this.normalizeError(error, "deleteDevices");
        }
    }

    async renameDevice(deviceId: string, displayName: string): Promise<void> {
        await this.updateDevice(deviceId, { display_name: displayName });
    }

    /**
     * 获取设备列表更新
     *
     * 后端实现: synapse-rust/src/web/routes/device.rs:46-47 (POST /keys/device_list_updates)
     */
    async getDeviceListUpdates(users: string[]): Promise<IDeviceListUpdatesResponse> {
        if (!users || users.length === 0) {
            throw new InvalidParamError("Users array is required");
        }

        try {
            const result = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IDeviceListUpdatesResponse>(
                    Method.Post,
                    dp("/keys/device_list_updates"),
                    undefined,
                    { users },
                    { prefix: ClientPrefix.V3 },
                );
            }, "getDeviceListUpdates");

            return {
                changed: Array.isArray(result?.changed) ? result.changed : [],
                left: Array.isArray(result?.left) ? result.left : [],
            };
        } catch (error) {
            throw this.normalizeError(error, "getDeviceListUpdates");
        }
    }

    getCurrentDeviceId(): string | null {
        return this.currentDeviceId;
    }

    getCurrentDevice(): IDevice | null {
        if (!this.currentDeviceId) {
            return null;
        }
        return this.deviceCache.get(this.currentDeviceId) ?? null;
    }

    getCachedDevices(): IDevice[] {
        return this.deviceListCache.get("devices") || [];
    }

    getCachedDevice(deviceId: string): IDevice | null {
        return this.deviceCache.get(deviceId) ?? null;
    }

    getOtherDevices(): IDevice[] {
        const devices = this.getCachedDevices();
        return devices.filter((d) => d.device_id !== this.currentDeviceId);
    }

    /**
     * 清除缓存
     */
    public clearCache(): void {
        this.deviceListCache.clear();
        this.deviceCache.clear();
    }

    /**
     * 获取缓存统计
     */
    public getCacheStats(): {
        deviceList: { size: number; hits: number; misses: number; hitRate: number };
        devices: { size: number; hits: number; misses: number; hitRate: number };
    } {
        return {
            deviceList: this.deviceListCache.getStats(),
            devices: this.deviceCache.getStats(),
        };
    }

    async start(): Promise<void> {
        if (this.initialized) return;

        try {
            await this.getDevices();
            this.initialized = true;
        } catch (e) {
            logger.warn("DeviceManager.start failed:", e);
        }
    }

    stop(): void {
        this.clearCache();
        this.initialized = false;
    }

    private recordRequest(success: boolean, retried: boolean): void {
        this.requestStats.total++;
        if (success) {
            this.requestStats.successful++;
        } else {
            this.requestStats.failed++;
        }
        if (retried) {
            this.requestStats.retried++;
        }
    }

    private isRetryableError(error: unknown): boolean {
        if (error instanceof MatrixError) {
            const retryableCodes = ["M_LIMIT_EXCEEDED", "M_SERVER_UNAVAILABLE"];
            const retryableStatus = [429, 500, 502, 503, 504];
            return retryableCodes.includes(error.errcode ?? "") || retryableStatus.includes(error.httpStatus ?? 0);
        }
        return false;
    }

    private getErrorType(error: unknown): string {
        if (error instanceof MatrixError) {
            return error.errcode ?? `http_${error.httpStatus}`;
        }
        if (error instanceof Error) {
            return error.name ?? "UnknownError";
        }
        return "UnknownError";
    }

    private emitMetric(type: string, method: string, data: Record<string, unknown>): void {
        try {
            this.emit(DeviceEvent.DeviceError, new Error(`Metric: ${type}.${method}`));
            logger.debug(`Metric: ${type}.${method}`, { type, method, ...data, timestamp: Date.now() });
        } catch {
            // 忽略监控发送错误，不影响主流程
        }
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getDeviceManager(): DeviceManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getDeviceManager = function (): DeviceManager {
        return getOrCreateManager(this, "device", () => new DeviceManager(this));
    };
}

export default extendMatrixClient;
