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

import { TypedEventEmitter } from "../models/typed-event-emitter.ts";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";
import { InvalidParamError } from "../common/errors.ts";
import { logger } from "../logger.ts";
import { MatrixClient } from "../client";
import { MatrixError } from "../http-api/errors.ts";
import { AuthError, NotFoundError, RetryableError, ApiError } from "../errors.ts";

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

interface CacheEntry<T> {
    value: T;
    timestamp: number;
}

class LRUCache<T> {
    private cache = new Map<string, CacheEntry<T>>();
    private readonly maxSize: number;
    private readonly ttl: number;
    private hits = 0;
    private misses = 0;

    constructor(maxSize: number, ttl: number) {
        this.maxSize = maxSize;
        this.ttl = ttl;
    }

    get(key: string): T | undefined {
        const entry = this.cache.get(key);
        if (!entry) {
            this.misses++;
            return undefined;
        }

        if (Date.now() - entry.timestamp > this.ttl) {
            this.cache.delete(key);
            this.misses++;
            return undefined;
        }

        this.hits++;
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.value;
    }

    set(key: string, value: T): void {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }

        this.cache.set(key, {
            value,
            timestamp: Date.now(),
        });
    }

    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    clear(): void {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
    }

    size(): number {
        return this.cache.size;
    }

    getStats(): { size: number; hits: number; misses: number; hitRate: number } {
        const total = this.hits + this.misses;
        return {
            size: this.cache.size,
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? this.hits / total : 0,
        };
    }
}

export class DeviceManager extends TypedEventEmitter<DeviceEvent, DeviceManagerEventMap> {
    private client: MatrixClient;
    private deviceListCache: LRUCache<IDevice[]>;
    private deviceCache: LRUCache<IDevice>;
    private currentDeviceId: string | null = null;
    private initialized: boolean = false;
    private readonly maxRetries = 3;
    private readonly retryDelay = 1000;

    private requestStats = {
        total: 0,
        successful: 0,
        failed: 0,
        retried: 0,
    };

    constructor(client: MatrixClient) {
        super();
        this.client = client;
        this.currentDeviceId = client.deviceId ?? null;
        
        this.deviceListCache = new LRUCache<IDevice[]>(10, 5 * 60 * 1000);
        this.deviceCache = new LRUCache<IDevice>(200, 10 * 60 * 1000);
    }

    /**
     * 获取所有设备
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
                    "/devices",
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 }
                );
            }, "getDevices");

            const devices: IDevice[] = result.devices || [];
            
            this.deviceListCache.set("devices", devices);
            devices.forEach(d => this.deviceCache.set(d.device_id, d));
            
            this.emit(DeviceEvent.DevicesUpdated, devices);
            
            return devices;
        } catch (error) {
            throw this.normalizeError(error, "getDevices");
        }
    }

    /**
     * 获取单个设备
     * 
     * 后端实现: synapse-rust/src/web/routes/device.rs:77-103
     */
    async getDevice(deviceId: string, forceRefresh = false): Promise<IDevice> {
        if (!deviceId) {
            throw new InvalidParamError("Device ID is required");
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
                    `/devices/${encodeURIComponent(deviceId)}`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 }
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
            throw this.normalizeError(error, "getDevice");
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
                    `/devices/${encodeURIComponent(deviceId)}`,
                    undefined,
                    updates,
                    { prefix: ClientPrefix.V3 }
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
            const err = error as Record<string, unknown>;
            if (err.errcode === 'M_UIA_REQUIRED' || (err.data && typeof err.data === 'object' && 'flows' in (err.data as Record<string, unknown>))) {
                throw new UIAError((err.data ?? err) as IUIAErrorData);
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
     * 后端实现: synapse-rust/src/web/routes/device.rs:135-153
     */
    async deleteDevice(deviceId: string, authDict?: IAuthDict): Promise<void> {
        if (!deviceId) {
            throw new InvalidParamError("Device ID is required");
        }

        if (deviceId === this.currentDeviceId) {
            throw new InvalidParamError("Cannot delete the current device");
        }

        try {
            const body: { auth?: IAuthDict } = {};
            if (authDict) {
                body.auth = authDict;
            }

            await this.withRetry(async () => {
                return await this.client.http.authedRequest(
                    Method.Delete,
                    `/devices/${encodeURIComponent(deviceId)}`,
                    undefined,
                    Object.keys(body).length > 0 ? body : undefined,
                    { prefix: ClientPrefix.V3 }
                );
            }, "deleteDevice");

            this.deviceCache.delete(deviceId);
            this.deviceListCache.delete("devices");
            this.emit(DeviceEvent.DeviceDeleted, deviceId);
        } catch (error) {
            const err = error as Record<string, unknown>;
            if (err.errcode === 'M_UIA_REQUIRED' || (err.data && typeof err.data === 'object' && 'flows' in (err.data as Record<string, unknown>))) {
                throw new UIAError((err.data ?? err) as IUIAErrorData);
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

        if (devices.includes(this.currentDeviceId ?? '')) {
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
                return await this.client.http.authedRequest(
                    Method.Post,
                    "/delete_devices",
                    undefined,
                    body,
                    { prefix: ClientPrefix.V3 }
                );
            }, "deleteDevices");

            devices.forEach(deviceId => {
                this.deviceCache.delete(deviceId);
                this.emit(DeviceEvent.DeviceDeleted, deviceId);
            });
            
            this.deviceListCache.delete("devices");
        } catch (error) {
            const err = error as any;
            if (err.errcode === 'M_UIA_REQUIRED' || err.data?.flows) {
                throw new UIAError(err.data ?? err);
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
     * 后端实现: synapse-rust/src/web/routes/device.rs:174-199
     */
    async getDeviceListUpdates(users: string[]): Promise<IDeviceListUpdatesResponse> {
        if (!users || users.length === 0) {
            throw new InvalidParamError("Users array is required");
        }

        try {
            const result = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IDeviceListUpdatesResponse>(
                    Method.Post,
                    "/keys/device_list/update",
                    undefined,
                    { users },
                    { prefix: ClientPrefix.V3 }
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
        return devices.filter(d => d.device_id !== this.currentDeviceId);
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

    /**
     * 获取请求统计
     */
    public getRequestStats(): typeof this.requestStats {
        return { ...this.requestStats };
    }

    /**
     * 重置请求统计
     */
    public resetRequestStats(): void {
        this.requestStats = {
            total: 0,
            successful: 0,
            failed: 0,
            retried: 0,
        };
    }

    async start(): Promise<void> {
        if (this.initialized) return;

        try {
            await this.getDevices();
            this.initialized = true;
        } catch (e) {
            logger.warn('DeviceManager.start failed:', e);
        }
    }

    stop(): void {
        this.clearCache();
        this.initialized = false;
    }

    /**
     * 带重试的请求封装
     */
    private async withRetry<T>(
        requestFn: () => Promise<T>,
        method: string,
        retries = this.maxRetries
    ): Promise<T> {
        let lastError: unknown;
        const startTime = Date.now();

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const result = await requestFn();
                this.recordRequest(true, attempt > 0);

                if (attempt > 0) {
                    logger.info(`DeviceManager.${method} succeeded after ${attempt} retries`, {
                        method,
                        attempts: attempt + 1,
                        duration: Date.now() - startTime,
                    });
                }

                return result;
            } catch (error: unknown) {
                lastError = error;

                if (!this.isRetryableError(error)) {
                    this.recordRequest(false, false);
                    this.emitMetric('api_error', method, {
                        error: this.getErrorType(error),
                        attempt: attempt + 1,
                        retryable: false
                    });
                    throw error;
                }

                if (attempt < retries) {
                    const delay = this.retryDelay * Math.pow(2, attempt);
                    logger.warn(`DeviceManager.${method} failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms`, {
                        method,
                        attempt: attempt + 1,
                        maxAttempts: retries + 1,
                        delay,
                        error: this.getErrorType(error),
                    });

                    this.emitMetric('api_retry', method, {
                        attempt: attempt + 1,
                        delay,
                        error: this.getErrorType(error)
                    });

                    await this.sleep(delay);
                }
            }
        }

        this.recordRequest(false, true);
        const duration = Date.now() - startTime;
        this.emitMetric('api_failure', method, {
            attempts: retries + 1,
            duration,
            error: this.getErrorType(lastError)
        });

        throw lastError;
    }

    /**
     * 记录请求统计
     */
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

    /**
     * 检查错误是否可重试
     */
    private isRetryableError(error: unknown): boolean {
        if (error instanceof MatrixError) {
            const retryableCodes = [
                "M_LIMIT_EXCEEDED",
                "M_SERVER_UNAVAILABLE",
            ];
            const retryableStatus = [429, 500, 502, 503, 504];
            return (
                retryableCodes.includes(error.errcode ?? "") ||
                retryableStatus.includes(error.httpStatus ?? 0)
            );
        }
        return false;
    }

    /**
     * 规范化错误
     */
    private normalizeError(error: unknown, method: string): Error {
        if (error instanceof MatrixError) {
            if (error.httpStatus === 404 || error.errcode === "M_NOT_FOUND") {
                return new NotFoundError(`DeviceManager.${method} failed: ${error.message}`, error);
            }
            if (error.httpStatus === 401 || error.errcode === "M_UNKNOWN_TOKEN") {
                return new AuthError(`DeviceManager.${method} failed: ${error.message}`, error);
            }
            if (this.isRetryableError(error)) {
                return new RetryableError(`DeviceManager.${method} failed: ${error.message}`, error);
            }
            return new ApiError(
                `DeviceManager.${method} failed: ${error.message}`,
                error.errcode ?? "UNKNOWN",
                error.httpStatus,
                error
            );
        }
        return new ApiError(
            `DeviceManager.${method} failed: ${error instanceof Error ? error.message : String(error)}`,
            "UNKNOWN",
            0,
            error
        );
    }

    /**
     * 获取错误类型
     */
    private getErrorType(error: unknown): string {
        if (error instanceof MatrixError) {
            return error.errcode ?? `http_${error.httpStatus}`;
        }
        if (error instanceof Error) {
            return error.name ?? "UnknownError";
        }
        return "UnknownError";
    }

    /**
     * 发送监控指标
     */
    private emitMetric(type: string, method: string, data: Record<string, unknown>): void {
        try {
            this.emit(DeviceEvent.DeviceError, new Error(`Metric: ${type}.${method}`));
            logger.debug(`Metric: ${type}.${method}`, { type, method, ...data, timestamp: Date.now() });
        } catch {
            // 忽略监控发送错误，不影响主流程
        }
    }

    /**
     * 延迟工具函数
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getDeviceManager(): DeviceManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getDeviceManager = function (): DeviceManager {
        return new DeviceManager(this);
    };
}

export default extendMatrixClient;
