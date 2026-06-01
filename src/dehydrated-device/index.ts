import { MatrixClient } from "../client";
import { BaseManager } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { getOrCreateManager } from "../client-infra/manager-registry";
import { doesClientAdvertiseSynapseRustFeature, SynapseRustFeature } from "../server-capabilities";

const MSC3814_PREFIX = "/_matrix/client/unstable/org.matrix.msc3814.v1";

export interface DehydratedDeviceData {
    algorithm: string;
    account: string;
}

export interface CreateDehydratedDeviceRequest {
    device_data: DehydratedDeviceData;
    initial_device_display_name?: string;
}

export interface CreateDehydratedDeviceResponse {
    device_id: string;
}

export interface DeviceInfo {
    device_id: string;
    device_data?: DehydratedDeviceData;
    initial_device_display_name?: string;
    created_at?: number;
    expires_at?: number;
    [key: string]: unknown;
}

export interface GetDevicesResponse {
    devices: DeviceInfo[];
}

export interface RehydrateData {
    algorithm: string;
    account: string;
}

export interface ClaimDehydratedDeviceRequest {
    rehydrate_data: RehydrateData;
}

export interface ClaimDehydratedDeviceResponse {
    [key: string]: unknown;
}

export interface UpdateDehydratedDeviceRequest {
    device_data: DehydratedDeviceData;
}

export interface UpdateDehydratedDeviceResponse {
    device_id: string;
}

export class DehydratedDeviceManager extends BaseManager {
    public constructor(client: MatrixClient) {
        super(client);
    }

    public async isSupported(): Promise<boolean> {
        return doesClientAdvertiseSynapseRustFeature(this.client, SynapseRustFeature.DehydratedDevice, true);
    }

    public async createDevice(data: CreateDehydratedDeviceRequest): Promise<CreateDehydratedDeviceResponse> {
        this.requireNonNull(data.device_data, "device_data");
        this.requireNonEmptyString(data.device_data.algorithm, "device_data.algorithm");
        this.requireNonEmptyString(data.device_data.account, "device_data.account");

        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<CreateDehydratedDeviceResponse>(
                Method.Post,
                "/dehydrated_device",
                undefined,
                data,
                { prefix: MSC3814_PREFIX },
            );
        }, "createDevice");
    }

    public async getDevice(deviceId: string): Promise<DeviceInfo> {
        this.requireNonEmptyString(deviceId, "deviceId");

        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<DeviceInfo>(
                Method.Get,
                `/dehydrated_device/${encodeURIComponent(deviceId)}`,
                undefined,
                undefined,
                { prefix: MSC3814_PREFIX },
            );
        }, "getDevice");
    }

    public async getDevices(): Promise<GetDevicesResponse> {
        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<GetDevicesResponse>(
                Method.Get,
                "/dehydrated_device",
                undefined,
                undefined,
                { prefix: MSC3814_PREFIX },
            );
        }, "getDevices");
    }

    public async claimDevice(deviceId: string, data: ClaimDehydratedDeviceRequest): Promise<ClaimDehydratedDeviceResponse> {
        this.requireNonEmptyString(deviceId, "deviceId");
        this.requireNonNull(data.rehydrate_data, "rehydrate_data");
        this.requireNonEmptyString(data.rehydrate_data.algorithm, "rehydrate_data.algorithm");
        this.requireNonEmptyString(data.rehydrate_data.account, "rehydrate_data.account");

        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<ClaimDehydratedDeviceResponse>(
                Method.Post,
                `/dehydrated_device/${encodeURIComponent(deviceId)}/claim`,
                undefined,
                data,
                { prefix: MSC3814_PREFIX },
            );
        }, "claimDevice");
    }

    public async updateDeviceData(deviceId: string, data: UpdateDehydratedDeviceRequest): Promise<UpdateDehydratedDeviceResponse> {
        this.requireNonEmptyString(deviceId, "deviceId");
        this.requireNonNull(data.device_data, "device_data");
        this.requireNonEmptyString(data.device_data.algorithm, "device_data.algorithm");
        this.requireNonEmptyString(data.device_data.account, "device_data.account");

        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<UpdateDehydratedDeviceResponse>(
                Method.Put,
                `/dehydrated_device/${encodeURIComponent(deviceId)}`,
                undefined,
                data,
                { prefix: MSC3814_PREFIX },
            );
        }, "updateDeviceData");
    }

    public async deleteDevice(deviceId: string): Promise<Record<string, never>> {
        this.requireNonEmptyString(deviceId, "deviceId");

        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<Record<string, never>>(
                Method.Delete,
                `/dehydrated_device/${encodeURIComponent(deviceId)}`,
                undefined,
                undefined,
                { prefix: MSC3814_PREFIX },
            );
        }, "deleteDevice");
    }

    public async getDeviceEvent(deviceId: string): Promise<Record<string, unknown>> {
        this.requireNonEmptyString(deviceId, "deviceId");

        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<Record<string, unknown>>(
                Method.Get,
                `/dehydrated_device/${encodeURIComponent(deviceId)}/initial_device`,
                undefined,
                undefined,
                { prefix: MSC3814_PREFIX },
            );
        }, "getDeviceEvent");
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getDehydratedDeviceManager(): DehydratedDeviceManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getDehydratedDeviceManager = function (): DehydratedDeviceManager {
        return getOrCreateManager(this, "dehydratedDevice", () => new DehydratedDeviceManager(this));
    };
}

export default extendMatrixClient;
