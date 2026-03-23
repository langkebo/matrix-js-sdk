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
 * 提供设备查询、更新、删除功能
 */

import { TypedEventEmitter } from "../models/typed-event-emitter.ts";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";
import { InvalidParamError } from "../common/errors.ts";
import { logger } from "../logger.ts";
import type { MatrixClient } from "../client.ts";

export enum DeviceEvent {
    DevicesUpdated = "DevicesUpdated",
    DeviceDeleted = "DeviceDeleted",
    DeviceUpdated = "DeviceUpdated",
    DeviceError = "DeviceError",
}

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

export class DeviceManager extends TypedEventEmitter<DeviceEvent, DeviceManagerEventMap> {
    private client: MatrixClient;
    private devices: Map<string, IDevice> = new Map();
    private currentDeviceId: string | null = null;
    private initialized: boolean = false;

    constructor(client: MatrixClient) {
        super();
        this.client = client;
        this.currentDeviceId = client.deviceId ?? null;
    }

    async getDevices(): Promise<IDevice[]> {
        try {
            const result = await this.client.http.authedRequest<IDevicesResponse>(
                Method.Get,
                "/_matrix/client/v3/devices",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );

            const devices: IDevice[] = result.devices || [];
            this.devices.clear();
            devices.forEach(d => this.devices.set(d.device_id, d));
            
            this.emit(DeviceEvent.DevicesUpdated, devices);
            
            return devices;
        } catch (error) {
            this.emit(DeviceEvent.DeviceError, error as Error);
            throw error;
        }
    }

    async getDevice(deviceId: string): Promise<IDevice> {
        if (!deviceId) {
            throw new InvalidParamError("Device ID is required");
        }

        if (this.devices.has(deviceId)) {
            return this.devices.get(deviceId)!;
        }

        try {
            const device = await this.client.http.authedRequest<IDeviceResponse>(
                Method.Get,
                `/_matrix/client/v3/devices/${encodeURIComponent(deviceId)}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );

            const fullDevice: IDevice = {
                device_id: device.device_id,
                display_name: device.display_name,
                last_seen_ip: device.last_seen_ip,
                last_seen_ts: device.last_seen_ts,
                user_id: device.user_id,
            };
            
            this.devices.set(deviceId, fullDevice);
            
            return fullDevice;
        } catch (error) {
            this.emit(DeviceEvent.DeviceError, error as Error);
            throw error;
        }
    }

    async updateDevice(deviceId: string, updates: IDeviceUpdateRequest): Promise<void> {
        if (!deviceId) {
            throw new InvalidParamError("Device ID is required");
        }

        if (!updates || Object.keys(updates).length === 0) {
            throw new InvalidParamError("No updates provided");
        }

        try {
            await this.client.http.authedRequest(
                Method.Put,
                `/_matrix/client/v3/devices/${encodeURIComponent(deviceId)}`,
                undefined,
                updates,
                { prefix: ClientPrefix.V3 }
            );

            const existingDevice = this.devices.get(deviceId);
            if (existingDevice) {
                const updatedDevice: IDevice = {
                    ...existingDevice,
                    ...updates,
                };
                this.devices.set(deviceId, updatedDevice);
                this.emit(DeviceEvent.DeviceUpdated, updatedDevice);
            }
        } catch (error) {
            const err = error as Record<string, unknown>;
            if (err.errcode === 'M_UIA_REQUIRED' || (err.data && typeof err.data === 'object' && 'flows' in (err.data as Record<string, unknown>))) {
                throw new UIAError((err.data ?? err) as IUIAErrorData);
            }
            this.emit(DeviceEvent.DeviceError, error as Error);
            throw error;
        }
    }

    async setDeviceDetails(deviceId: string, updates: IDeviceUpdateRequest): Promise<void> {
        return this.updateDevice(deviceId, updates);
    }

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

            await this.client.http.authedRequest(
                Method.Delete,
                `/_matrix/client/v3/devices/${encodeURIComponent(deviceId)}`,
                undefined,
                Object.keys(body).length > 0 ? body : undefined,
                { prefix: ClientPrefix.V3 }
            );

            this.devices.delete(deviceId);
            this.emit(DeviceEvent.DeviceDeleted, deviceId);
        } catch (error) {
            const err = error as Record<string, unknown>;
            if (err.errcode === 'M_UIA_REQUIRED' || (err.data && typeof err.data === 'object' && 'flows' in (err.data as Record<string, unknown>))) {
                throw new UIAError((err.data ?? err) as IUIAErrorData);
            }
            this.emit(DeviceEvent.DeviceError, error as Error);
            throw error;
        }
    }

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

            await this.client.http.authedRequest(
                Method.Post,
                "/_matrix/client/v3/delete_devices",
                undefined,
                body,
                { prefix: ClientPrefix.V3 }
            );

            devices.forEach(deviceId => {
                this.devices.delete(deviceId);
                this.emit(DeviceEvent.DeviceDeleted, deviceId);
            });
        } catch (error) {
            const err = error as any;
            if (err.errcode === 'M_UIA_REQUIRED' || err.data?.flows) {
                throw new UIAError(err.data ?? err);
            }
            this.emit(DeviceEvent.DeviceError, error as Error);
            throw error;
        }
    }

    async renameDevice(deviceId: string, displayName: string): Promise<void> {
        await this.updateDevice(deviceId, { display_name: displayName });
    }

    getCurrentDeviceId(): string | null {
        return this.currentDeviceId;
    }

    getCurrentDevice(): IDevice | null {
        if (!this.currentDeviceId) {
            return null;
        }
        return this.devices.get(this.currentDeviceId) ?? null;
    }

    getCachedDevices(): IDevice[] {
        return Array.from(this.devices.values());
    }

    getCachedDevice(deviceId: string): IDevice | null {
        return this.devices.get(deviceId) ?? null;
    }

    getOtherDevices(): IDevice[] {
        return Array.from(this.devices.values())
            .filter(d => d.device_id !== this.currentDeviceId);
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
        this.devices.clear();
        this.initialized = false;
    }
}
