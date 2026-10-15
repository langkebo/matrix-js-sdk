import { MatrixClient } from "../client";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
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

export interface DeviceStatusResponse {
    exists: boolean;
}

export class DehydratedDeviceManager extends BaseManager {
    public constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 判断后端是否声明支持 dehydrated device 能力。
     *
     * 能力探测失败时按 `false` 处理（fail-closed），避免误判导致后续请求 404。
     *
     * @returns 后端支持 dehydrated device 时返回 `true`，否则 `false`。
     * @example
     * ```ts
     * const client = matrix.createClient({ baseUrl, accessToken });
     * await client.whenManagerExtensionsReady();
     * const supported = await client.getDehydratedDeviceManager().isSupported();
     * ```
     */
    public async isSupported(): Promise<boolean> {
        // 后端未实 DehydratedDevice：探测失败时绝不能误判支持（FT-S13）
        return doesClientAdvertiseSynapseRustFeature(this.client, SynapseRustFeature.DehydratedDevice, false);
    }

    /**
     * 创建 dehydrated device。
     *
     * @param data - 设备数据，需包含 `device_data.algorithm` 与 `device_data.account`。
     * @returns 新建设备的 `device_id`。
     * @throws 当 `device_data` / `algorithm` / `account` 缺失或为空时抛出校验错误。
     * @example
     * ```ts
     * const client = matrix.createClient({ baseUrl, accessToken });
     * await client.whenManagerExtensionsReady();
     * const res = await client.getDehydratedDeviceManager().createDevice({
     *     device_data: { algorithm: "m.dehydration.v1.olm", account: "..." },
     * });
     * ```
     */
    public async createDevice(data: CreateDehydratedDeviceRequest): Promise<CreateDehydratedDeviceResponse> {
        this.requireNonNull(data.device_data, "device_data");
        this.requireNonEmptyString(data.device_data.algorithm, "device_data.algorithm");
        this.requireNonEmptyString(data.device_data.account, "device_data.account");

        return await this.withRetry(async () => {
            return await this.request<CreateDehydratedDeviceResponse>({
                method: Method.Put,
                path: "/dehydrated_device",
                body: data,
                prefix: MSC3814_PREFIX,
            });
        }, "createDevice");
    }

    /**
     * 获取指定 dehydrated device 的信息。
     *
     * @param deviceId - 目标 dehydrated device 的 ID。
     * @returns 设备信息（`DeviceInfo`）。
     * @throws 当 `deviceId` 为空时抛出校验错误。
     * @example
     * ```ts
     * const info = await client.getDehydratedDeviceManager().getDevice("DEHYDRATED_DEVICE_ID");
     * ```
     */
    public async getDevice(deviceId: string): Promise<DeviceInfo> {
        this.requireNonEmptyString(deviceId, "deviceId");

        return await this.withRetry(async () => {
            return await this.request<DeviceInfo>({
                method: Method.Get,
                path: "/dehydrated_device",
                prefix: MSC3814_PREFIX,
            });
        }, "getDevice");
    }

    /**
     * 列出当前账户下的所有 dehydrated device。
     *
     * @returns 设备列表（`GetDevicesResponse`）。
     * @example
     * ```ts
     * const { devices } = await client.getDehydratedDeviceManager().getDevices();
     * ```
     */
    public async getDevices(): Promise<GetDevicesResponse> {
        return await this.withRetry(async () => {
            return await this.request<GetDevicesResponse>({
                method: Method.Get,
                path: "/dehydrated_device",
                prefix: MSC3814_PREFIX,
            });
        }, "getDevices");
    }

    /**
     * 查询 dehydrated device 的存在状态。
     *
     * @returns 含 `exists` 字段的状态响应。
     * @example
     * ```ts
     * const status = await client.getDehydratedDeviceManager().getDeviceStatus();
     * ```
     */
    public async getDeviceStatus(): Promise<DeviceStatusResponse> {
        return await this.withRetry(async () => {
            return await this.request<DeviceStatusResponse>({
                method: Method.Get,
                path: "/dehydrated_device/status",
                prefix: MSC3814_PREFIX,
            });
        }, "getDeviceStatus");
    }

    /**
     * 认领（claim）一个 dehydrated device，并使用 `rehydrate_data` 完成重水化。
     *
     * @param deviceId - 目标 dehydrated device 的 ID。
     * @param data - 重水化数据，需包含 `rehydrate_data.algorithm` 与 `rehydrate_data.account`。
     * @returns 后端返回的认领结果。
     * @throws 当 `deviceId` 为空或 `rehydrate_data` 相关字段缺失时抛出校验错误。
     * @example
     * ```ts
     * const res = await client.getDehydratedDeviceManager().claimDevice("DEHYDRATED_DEVICE_ID", {
     *     rehydrate_data: { algorithm: "m.dehydration.v1.olm", account: "..." },
     * });
     * ```
     */
    public async claimDevice(
        deviceId: string,
        data: ClaimDehydratedDeviceRequest,
    ): Promise<ClaimDehydratedDeviceResponse> {
        this.requireNonEmptyString(deviceId, "deviceId");
        this.requireNonNull(data.rehydrate_data, "rehydrate_data");
        this.requireNonEmptyString(data.rehydrate_data.algorithm, "rehydrate_data.algorithm");
        this.requireNonEmptyString(data.rehydrate_data.account, "rehydrate_data.account");

        return await this.withRetry(async () => {
            return await this.request<ClaimDehydratedDeviceResponse>({
                method: Method.Post,
                path: `/dehydrated_device/${encodeURIComponent(deviceId)}/events`,
                body: data,
                prefix: MSC3814_PREFIX,
            });
        }, "claimDevice");
    }

    /**
     * 更新 dehydrated device 的设备数据。
     *
     * @param deviceId - 目标 dehydrated device 的 ID。
     * @param data - 新的设备数据，需包含 `device_data.algorithm` 与 `device_data.account`。
     * @returns 更新后的 `device_id`。
     * @throws 当 `deviceId` 为空或 `device_data` 相关字段缺失时抛出校验错误。
     * @example
     * ```ts
     * await client.getDehydratedDeviceManager().updateDeviceData("DEHYDRATED_DEVICE_ID", {
     *     device_data: { algorithm: "m.dehydration.v1.olm", account: "..." },
     * });
     * ```
     */
    public async updateDeviceData(
        deviceId: string,
        data: UpdateDehydratedDeviceRequest,
    ): Promise<UpdateDehydratedDeviceResponse> {
        this.requireNonEmptyString(deviceId, "deviceId");
        this.requireNonNull(data.device_data, "device_data");
        this.requireNonEmptyString(data.device_data.algorithm, "device_data.algorithm");
        this.requireNonEmptyString(data.device_data.account, "device_data.account");

        return await this.withRetry(async () => {
            return await this.request<UpdateDehydratedDeviceResponse>({
                method: Method.Put,
                path: "/dehydrated_device",
                body: data,
                prefix: MSC3814_PREFIX,
            });
        }, "updateDeviceData");
    }

    /**
     * 删除指定 dehydrated device。
     *
     * @param deviceId - 目标 dehydrated device 的 ID。
     * @returns 空对象。
     * @throws 当 `deviceId` 为空时抛出校验错误。
     * @example
     * ```ts
     * await client.getDehydratedDeviceManager().deleteDevice("DEHYDRATED_DEVICE_ID");
     * ```
     */
    public async deleteDevice(deviceId: string): Promise<Record<string, never>> {
        this.requireNonEmptyString(deviceId, "deviceId");

        return await this.withRetry(async () => {
            return await this.request<Record<string, never>>({
                method: Method.Delete,
                path: "/dehydrated_device",
                prefix: MSC3814_PREFIX,
            });
        }, "deleteDevice");
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getDehydratedDeviceManager = function (): DehydratedDeviceManager {
        registerManagerClass("dehydratedDevice", DehydratedDeviceManager);
        return getOrCreateManager(this, "dehydratedDevice", () => new DehydratedDeviceManager(this));
    };
}
