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
 * Device Keys Manager - 设备密钥管理
 * 
 * 提供设备密钥、一次性密钥、签名等 E2EE 核心功能
 * 对应后端: synapse-rust/src/web/routes/e2ee_routes.rs
 * 
 * 后端端点 (compat - r0/v1/v3):
 * - POST /keys/upload - 上传设备密钥和一次性密钥
 * - POST /keys/query - 查询设备密钥
 * - POST /keys/claim - 声明一次性密钥
 * - GET /keys/changes - 获取密钥变化
 * - POST /keys/device_list/update - 更新设备列表
 * - POST /keys/signatures - 上传签名
 * - POST /keys/device_signing/upload - 上传设备签名
 * - POST /room_keys/request - 创建密钥请求
 * - GET /room_keys/request - 获取密钥请求
 * - DELETE /room_keys/request/{request_id} - 删除密钥请求
 * - GET /rooms/{room_id}/keys/distribution - 获取房间密钥分发
 * - PUT /sendToDevice/{event_type}/{transaction_id} - 发送设备消息
 */

import { TypedEventEmitter } from "../models/typed-event-emitter.ts";
import { MatrixClient } from "../client";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";
import { MatrixError } from "../http-api/errors.ts";
import { AuthError, NotFoundError, ApiError, SdkError } from "../errors.ts";

export interface DeviceKeys {
    user_id: string;
    device_id: string;
    algorithms: string[];
    keys: Record<string, string>;
    signatures: Record<string, Record<string, string>>;
    unsigned?: Record<string, unknown>;
}

export interface OneTimeKeys {
    [keyId: string]: {
        key: string;
        signatures?: Record<string, Record<string, string>>;
    };
}

export interface UploadKeysResponse {
    one_time_key_counts?: Record<string, number>;
}

export interface QueryKeysRequest {
    device_keys?: Record<string, string[]>;
    token?: string;
}

export interface QueryKeysResponse {
    device_keys?: Record<string, Record<string, DeviceKeys>>;
    failures?: Record<string, Record<string, string>>;
}

export interface ClaimKeysRequest {
    one_time_keys: Record<string, Record<string, string>>;
}

export type OneTimeKeysMap = Record<string, Record<string, Record<string, unknown>>>;

export interface ClaimKeysResponse {
    one_time_keys?: OneTimeKeysMap;
    failures?: Record<string, Record<string, string>>;
}

export interface KeyChangesResponse {
    changed?: string[];
    left?: string[];
}

export interface RoomKeyRequest {
    request_id: string;
    user_id: string;
    device_id: string;
    room_id: string;
    session_id: string;
    algorithm: string;
    request_type?: string;
    action?: string;
    status?: string;
    created_ts?: number;
}

export interface RoomKeyRequestsResponse {
    requests: RoomKeyRequest[];
}

export interface SendToDeviceMessage {
    [userId: string]: {
        [deviceId: string]: Record<string, unknown>;
    };
}

export interface KeyDistributionResponse {
    room_id: string;
    algorithm: string;
    session_id: string;
    session_key: string;
}

export enum DeviceKeysEvent {
    KeysUploaded = "KeysUploaded",
    KeysQueried = "KeysQueried",
    KeyClaimed = "KeyClaimed",
    DeviceListUpdated = "DeviceListUpdated",
    RoomKeyRequested = "RoomKeyRequested",
}

interface DeviceKeysManagerEventMap {
    [DeviceKeysEvent.KeysUploaded]: (counts: Record<string, number>) => void;
    [DeviceKeysEvent.KeysQueried]: (deviceKeys: Record<string, Record<string, DeviceKeys>>) => void;
    [DeviceKeysEvent.KeyClaimed]: (keys: OneTimeKeysMap) => void;
    [DeviceKeysEvent.DeviceListUpdated]: (changed: string[], left: string[]) => void;
    [DeviceKeysEvent.RoomKeyRequested]: (requests: RoomKeyRequest[]) => void;
}

export class DeviceKeysManager extends TypedEventEmitter<DeviceKeysEvent, DeviceKeysManagerEventMap> {
    private client: MatrixClient;

    constructor(client: MatrixClient) {
        super();
        this.client = client;
    }

    private normalizeError(error: unknown, method: string): SdkError {
        const err = error as Error;
        if (error instanceof MatrixError) {
            if (error.httpStatus === 401 || error.errcode === 'M_UNKNOWN_TOKEN') {
                return new AuthError(`DeviceKeysManager.${method} failed: ${err?.message ?? 'Unknown error'}`, error);
            }
            if (error.httpStatus === 404 || error.errcode === 'M_NOT_FOUND') {
                return new NotFoundError(`DeviceKeysManager.${method} failed: ${err?.message ?? 'Unknown error'}`, error);
            }
            return new ApiError(`DeviceKeysManager.${method} failed: ${err?.message ?? 'Unknown error'}`, error.errcode ?? 'UNKNOWN', error.httpStatus ?? 0, error);
        }
        return new ApiError(`DeviceKeysManager.${method} failed: ${err?.message ?? String(error)}`, 'UNKNOWN', 0, error);
    }

    /**
     * 上传设备密钥和一次性密钥
     * POST /_matrix/client/r0/keys/upload
     */
    async uploadKeys(options: {
        deviceKeys?: DeviceKeys;
        oneTimeKeys?: OneTimeKeys;
    }): Promise<UploadKeysResponse> {
        try {
            const body: Record<string, unknown> = {};
            
            if (options.deviceKeys) {
                body.device_keys = options.deviceKeys;
            }
            
            if (options.oneTimeKeys) {
                body.one_time_keys = options.oneTimeKeys;
            }

            const response = await this.client.http.authedRequest<UploadKeysResponse>(
                Method.Post,
                "/keys/upload",
                undefined,
                body,
                { prefix: ClientPrefix.V3 }
            );

            if (response.one_time_key_counts) {
                this.emit(DeviceKeysEvent.KeysUploaded, response.one_time_key_counts);
            }

            return response;
        } catch (error) {
            throw this.normalizeError(error, "uploadKeys");
        }
    }

    /**
     * 查询设备密钥
     * POST /_matrix/client/r0/keys/query
     */
    async queryKeys(request: QueryKeysRequest): Promise<QueryKeysResponse> {
        try {
            const response = await this.client.http.authedRequest<QueryKeysResponse>(
                Method.Post,
                "/keys/query",
                undefined,
                request,
                { prefix: ClientPrefix.V3 }
            );

            if (response.device_keys) {
                this.emit(DeviceKeysEvent.KeysQueried, response.device_keys);
            }

            return response;
        } catch (error) {
            throw this.normalizeError(error, "queryKeys");
        }
    }

    /**
     * 声明一次性密钥
     * POST /_matrix/client/r0/keys/claim
     */
    async claimKeys(request: ClaimKeysRequest): Promise<ClaimKeysResponse> {
        try {
            const response = await this.client.http.authedRequest<ClaimKeysResponse>(
                Method.Post,
                "/keys/claim",
                undefined,
                request,
                { prefix: ClientPrefix.V3 }
            );

            if (response.one_time_keys) {
                this.emit(DeviceKeysEvent.KeyClaimed, response.one_time_keys);
            }

            return response;
        } catch (error) {
            throw this.normalizeError(error, "claimKeys");
        }
    }

    /**
     * 获取密钥变化
     * GET /_matrix/client/r0/keys/changes
     */
    async getKeyChanges(from: string, to?: string): Promise<KeyChangesResponse> {
        try {
            const params: Record<string, string> = { from };
            if (to) params.to = to;

            const response = await this.client.http.authedRequest<KeyChangesResponse>(
                Method.Get,
                "/keys/changes",
                params,
                undefined,
                { prefix: ClientPrefix.V3 }
            );

            if (response.changed || response.left) {
                this.emit(DeviceKeysEvent.DeviceListUpdated, response.changed || [], response.left || []);
            }

            return response;
        } catch (error) {
            throw this.normalizeError(error, "getKeyChanges");
        }
    }

    /**
     * 更新设备列表
     * POST /_matrix/client/r0/keys/device_list/update
     */
    async updateDeviceList(users: string[], since?: string): Promise<{ changed: string[]; left: string[]; stream_id?: number }> {
        try {
            const body: Record<string, unknown> = { users };
            
            if (since) {
                body.since = since;
            }

            const response = await this.client.http.authedRequest<{ changed?: string[]; left?: string[]; stream_id?: number }>(
                Method.Post,
                "/keys/device_list/update",
                undefined,
                body,
                { prefix: ClientPrefix.V3 }
            );

            return {
                changed: response.changed || [],
                left: response.left || [],
                stream_id: response.stream_id,
            };
        } catch (error) {
            throw this.normalizeError(error, "updateDeviceList");
        }
    }

    async uploadSignatures(signatures: Record<string, Record<string, Record<string, string>>>): Promise<Record<string, unknown>> {
        try {
            return await this.client.http.authedRequest<Record<string, unknown>>(
                Method.Post,
                "/keys/signatures",
                undefined,
                signatures,
                { prefix: ClientPrefix.V3 }
            );
        } catch (error) {
            throw this.normalizeError(error, "uploadSignatures");
        }
    }

    /**
     * 上传设备签名密钥
     * POST /_matrix/client/r0/keys/device_signing/upload
     */
    async uploadDeviceSigning(keys: {
        master_key?: Record<string, unknown>;
        self_signing_key?: Record<string, unknown>;
        user_signing_key?: Record<string, unknown>;
    }): Promise<void> {
        try {
            await this.client.http.authedRequest(
                Method.Post,
                "/keys/device_signing/upload",
                undefined,
                keys,
                { prefix: ClientPrefix.V3 }
            );
        } catch (error) {
            throw this.normalizeError(error, "uploadDeviceSigning");
        }
    }

    /**
     * 创建房间密钥请求
     * POST /_matrix/client/r0/room_keys/request
     */
    async createRoomKeyRequest(request: {
        room_id: string;
        session_id: string;
        algorithm: string;
        request_type?: string;
        request_id?: string;
    }): Promise<{ request_id: string }> {
        try {
            const response = await this.client.http.authedRequest<{ request_id: string }>(
                Method.Post,
                "/room_keys/request",
                undefined,
                request,
                { prefix: ClientPrefix.V3 }
            );

            return response;
        } catch (error) {
            throw this.normalizeError(error, "createRoomKeyRequest");
        }
    }

    /**
     * 获取房间密钥请求
     * GET /_matrix/client/r0/room_keys/request
     */
    async getRoomKeyRequests(options?: {
        status?: string;
        room_id?: string;
        session_id?: string;
        limit?: number;
    }): Promise<RoomKeyRequestsResponse> {
        try {
            const params: Record<string, string> = {};
            if (options?.status) params.status = options.status;
            if (options?.room_id) params.room_id = options.room_id;
            if (options?.session_id) params.session_id = options.session_id;

            const response = await this.client.http.authedRequest<RoomKeyRequestsResponse>(
                Method.Get,
                "/room_keys/request",
                Object.keys(params).length > 0 ? params : undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );

            if (response.requests) {
                this.emit(DeviceKeysEvent.RoomKeyRequested, response.requests);
            }

            return response;
        } catch (error) {
            throw this.normalizeError(error, "getRoomKeyRequests");
        }
    }

    /**
     * 删除房间密钥请求
     * DELETE /_matrix/client/r0/room_keys/request/{request_id}
     */
    async deleteRoomKeyRequest(requestId: string): Promise<void> {
        try {
            await this.client.http.authedRequest(
                Method.Delete,
                `/room_keys/request/${encodeURIComponent(requestId)}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        } catch (error) {
            throw this.normalizeError(error, "deleteRoomKeyRequest");
        }
    }

    /**
     * 获取房间密钥分发
     * GET /_matrix/client/r0/rooms/{room_id}/keys/distribution
     */
    async getRoomKeyDistribution(roomId: string): Promise<KeyDistributionResponse> {
        try {
            return await this.client.http.authedRequest<KeyDistributionResponse>(
                Method.Get,
                `/rooms/${encodeURIComponent(roomId)}/keys/distribution`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        } catch (error) {
            throw this.normalizeError(error, "getRoomKeyDistribution");
        }
    }

    /**
     * 发送设备消息
     * PUT /_matrix/client/r0/sendToDevice/{event_type}/{transaction_id}
     */
    async sendToDevice(
        eventType: string,
        transactionId: string,
        messages: SendToDeviceMessage
    ): Promise<void> {
        try {
            await this.client.http.authedRequest(
                Method.Put,
                `/sendToDevice/${encodeURIComponent(eventType)}/${encodeURIComponent(transactionId)}`,
                undefined,
                { messages },
                { prefix: ClientPrefix.V3 }
            );
        } catch (error) {
            throw this.normalizeError(error, "sendToDevice");
        }
    }

    public async getDeviceKeys(userId: string): Promise<Record<string, DeviceKeys>> {
        return (this.client as unknown as {
            getDeviceKeys: (userId: string) => Promise<Record<string, DeviceKeys>>;
        }).getDeviceKeys(userId);
    }

    public async uploadDeviceKeys(keys: DeviceKeys): Promise<UploadKeysResponse> {
        return (this.client as unknown as {
            uploadDeviceKeys: (keys: DeviceKeys) => Promise<UploadKeysResponse>;
        }).uploadDeviceKeys(keys);
    }

    public async getUserDevices(userId: string): Promise<Record<string, DeviceKeys>> {
        return (this.client as unknown as {
            getUserDevices: (userId: string) => Promise<Record<string, DeviceKeys>>;
        }).getUserDevices(userId);
    }

    public hasDevice(deviceId: string): boolean {
        return (this.client as unknown as {
            hasDevice: (deviceId: string) => boolean;
        }).hasDevice(deviceId);
    }

    public getDevice(deviceId: string): DeviceKeys | null {
        return (this.client as unknown as {
            getDevice: (deviceId: string) => DeviceKeys | null;
        }).getDevice(deviceId);
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getDeviceKeysManager(): DeviceKeysManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getDeviceKeysManager = function (): DeviceKeysManager {
        return new DeviceKeysManager(this);
    };
}

export default extendMatrixClient;
