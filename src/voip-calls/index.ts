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
 * VoIP Calls Manager - VoIP通话管理
 *
 * 对接后端: synapse-rust/src/web/routes/voip.rs
 * 后端提供:
 *   - GET  /voip/turnServer          (获取TURN服务器)
 *   - GET  /voip/config              (获取VoIP配置)
 *   - GET  /voip/turnServer/guest     (访客TURN凭据)
 *   - PUT  /rooms/{room_id}/send/m.call.invite/{txn_id}     (呼叫邀请)
 *   - PUT  /rooms/{room_id}/send/m.call.candidates/{txn_id} (ICE候选)
 *   - PUT  /rooms/{room_id}/send/m.call.answer/{txn_id}     (应答)
 *   - PUT  /rooms/{room_id}/send/m.call.hangup/{txn_id}     (挂断)
 *   - GET  /rooms/{room_id}/call/{call_id}                   (获取通话会话)
 */

import { MatrixClient } from "../client";
import { MatrixCall } from "../web-rtc/call";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { InvalidParamError } from "../common/errors";
import { logger } from "../logger";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface ITurnServerResponse {
    uris: string[];
    username: string;
    password: string;
    ttl: number;
}

export interface IVoipConfigResponse {
    enabled: boolean;
    force_turn?: boolean;
    turn_servers?: ITurnServerResponse[];
    stun_servers?: string[];
}

export interface ICallSessionResponse {
    call_id: string;
    room_id: string;
    state: string;
    created_ts: number;
    participants?: string[];
}

export interface VoIPCallsManagerEvents {
    callCreated: (payload: { roomId: string; call: MatrixCall }) => void;
    callEnded: (payload: { roomId: string; callId: string }) => void;
    callAnswered: (payload: { roomId: string; callId: string }) => void;
    turnServersUpdated: (payload: { servers: ITurnServerResponse }) => void;
}

export class VoIPCallsManager extends BaseManager<keyof VoIPCallsManagerEvents, VoIPCallsManagerEvents> {
    private cachedTurnServers: ITurnServerResponse | null = null;
    private cachedVoipConfig: IVoipConfigResponse | null = null;
    private turnServerExpiry = 0;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public createCall(roomId: string): MatrixCall | null {
        if (!roomId) {
            throw new InvalidParamError("roomId is required");
        }
        return this.client.createCall(roomId);
    }

    public setSupportsCallTransfer(support: boolean): void {
        this.client.setSupportsCallTransfer(support);
    }

    private getCallList(): MatrixCall[] {
        const handler = (this.client as unknown as { callEventHandler?: { calls: Map<string, MatrixCall> } })
            .callEventHandler;
        if (!handler?.calls) return [];
        return Array.from(handler.calls.values()) as MatrixCall[];
    }

    public getCall(roomId: string): MatrixCall | null {
        if (!roomId) {
            throw new InvalidParamError("roomId is required");
        }
        return this.getCallList().find((call) => call.roomId === roomId) ?? null;
    }

    public getAllCalls(): MatrixCall[] {
        return [...this.getCallList()];
    }

    public getCallsForRoom(roomId: string): MatrixCall[] {
        if (!roomId) {
            throw new InvalidParamError("roomId is required");
        }
        return this.getCallList().filter((call) => call.roomId === roomId);
    }

    public async terminateAllCalls(): Promise<void> {
        const calls = [...this.getCallList()];
        for (const call of calls) {
            try {
                call.hangup("user_hangup" as import("../web-rtc/call").CallErrorCode, true);
            } catch (e) {
                logger.warn("VoIPCallsManager.terminateAllCalls: failed to hangup call", e);
            }
        }
    }

    public async getTurnServers(): Promise<ITurnServerResponse> {
        if (this.cachedTurnServers && Date.now() < this.turnServerExpiry) {
            return this.cachedTurnServers;
        }

        return this.withRetry(async () => {
            const response = await this.request<ITurnServerResponse>({
                method: Method.Get,
                path: "/voip/turnServer",
                prefix: ClientPrefix.R0,
            });
            this.cachedTurnServers = response;
            this.turnServerExpiry = Date.now() + (response.ttl ?? 3600) * 1000;
            this.emit("turnServersUpdated", { servers: response });
            return response;
        }, "getTurnServers");
    }

    public async getVoipConfig(): Promise<IVoipConfigResponse> {
        if (this.cachedVoipConfig) {
            return this.cachedVoipConfig;
        }

        return this.withRetry(async () => {
            const response = await this.request<IVoipConfigResponse>({
                method: Method.Get,
                path: "/voip/config",
                prefix: ClientPrefix.R0,
            });
            this.cachedVoipConfig = response;
            return response;
        }, "getVoipConfig");
    }

    public async getGuestTurnCredentials(): Promise<ITurnServerResponse> {
        return this.withRetry(
            () =>
                this.request<ITurnServerResponse>({
                    method: Method.Get,
                    path: "/voip/turnServer/guest",
                    prefix: ClientPrefix.R0,
                }),
            "getGuestTurnCredentials",
        );
    }

    public async getCallSession(roomId: string, callId: string): Promise<ICallSessionResponse> {
        if (!roomId) {
            throw new InvalidParamError("roomId is required");
        }
        if (!callId) {
            throw new InvalidParamError("callId is required");
        }

        return this.withRetry(
            () =>
                this.request<ICallSessionResponse>({
                    method: Method.Get,
                    path: `/rooms/${encodeURIComponent(roomId)}/call/${encodeURIComponent(callId)}`,
                    prefix: ClientPrefix.R0,
                }),
            "getCallSession",
        );
    }

    public async getCallTracking(roomId: string, callId: string): Promise<ICallSessionResponse> {
        if (!roomId) {
            throw new InvalidParamError("roomId is required");
        }
        if (!callId) {
            throw new InvalidParamError("callId is required");
        }

        return this.withRetry(
            () =>
                this.request<ICallSessionResponse>({
                    method: Method.Get,
                    path: `/rooms/${encodeURIComponent(roomId)}/call/${encodeURIComponent(callId)}`,
                    prefix: ClientPrefix.V3,
                }),
            "getCallTracking",
        );
    }

    public invalidateTurnServerCache(): void {
        this.cachedTurnServers = null;
        this.turnServerExpiry = 0;
    }

    public invalidateVoipConfigCache(): void {
        this.cachedVoipConfig = null;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getVoIPCallsManager = function (): VoIPCallsManager {
        registerManagerClass("voipCalls", VoIPCallsManager);
        return getOrCreateManager(this, "voipCalls", () => new VoIPCallsManager(this));
    };
}

export default extendMatrixClient;
