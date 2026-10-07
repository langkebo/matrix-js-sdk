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
 * Turn Server Manager - TURN服务器管理
 *
 * 提供TURN服务器信息获取功能
 */

import { MatrixClient } from "../client";
import { type ITurnServer, type ITurnServerResponse } from "../client";
import { ClientEvent } from "../client";
import { type HTTPError } from "../http-api/index";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { logger } from "../logger";
import type { AuthPath } from "../auth/__generated__/route-table";
import type { PathAssert, StripV3 } from "../http-api/strip-prefix";

/**
 * 校验并返回 VoIP 路径。
 *
 * `voip/*` 路由由后端 `synapse-web/src/routes/assembly.rs` 的 `create_voip_compat_router`
 * 注册（ledger 归属 `assembly::voip_compat`）。本仓把 ledger 模块 `assembly` 映射到 SDK 的
 * `auth` 目录（见 `docs/sdk-encapsulation-audit.md` §13.14），故断言落在 `AuthPath` 上 ——
 * 属**跨模块归属**，与 `RoomManager` 引 `SearchPath`/`ModerationPath` 的既有约定一致。
 */
function vp<const P extends string>(path: P & PathAssert<P, StripV3<AuthPath>>): P {
    return path;
}

/**
 * `GET /_matrix/client/v3/voip/config` 的响应。
 *
 * 对应后端 `synapse-web/src/routes/voip.rs::VoipConfigResponse`。
 * 后端保证 `turn_servers` 在服务未启用时也返回**空数组**（而非 null），便于调用方直接遍历。
 */
export interface IVoipConfigResponse {
    turn_servers?: ITurnServer[] | null;
    stun_servers?: string[] | null;
}

const TURN_CHECK_INTERVAL = 30 * 1000;

export interface TurnServerManagerEvents {
    turn_servers_updated: (data: { servers: ITurnServer[] }) => void;
    turn_server_expired: () => void;
}

export class TurnServerManager extends BaseManager<keyof TurnServerManagerEvents, TurnServerManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public getTurnServers(): ITurnServer[] {
        return this.internalClient.turnServers || [];
    }

    public async getTurnServerConfig(): Promise<ITurnServerResponse> {
        return this.withRetry(async () => {
            return await this.request<ITurnServerResponse>({
                method: Method.Get,
                path: vp("/voip/turnServer"),
                prefix: ClientPrefix.V3,
            });
        }, "getTurnServerConfig");
    }

    /**
     * 获取 VoIP 全局配置（TURN / STUN 服务器列表）。
     *
     * 对应 `GET /_matrix/client/v3/voip/config`。
     *
     * 与 `getTurnServerConfig()` 的区别：后者返回**当前用户**的一组 TURN 凭据；
     * 本方法返回**服务端配置视图**（可能含静态 STUN 列表与多条 TURN 记录），
     * 便于客户端在建立通话前做整体可用性判断。
     *
     * @returns VoIP 配置；服务未启用时 `turn_servers` 为空数组、`stun_servers` 为 null
     * @example
     * ```typescript
     * const config = await client.getTurnServerManager().getVoipConfig();
     * console.log(config.turn_servers?.length ?? 0, "TURN servers configured");
     * ```
     */
    public async getVoipConfig(): Promise<IVoipConfigResponse> {
        return this.withRetry(async () => {
            return await this.request<IVoipConfigResponse>({
                method: Method.Get,
                path: vp("/voip/config"),
                prefix: ClientPrefix.V3,
            });
        }, "getVoipConfig");
    }

    /**
     * 获取**访客**（未登录用户）的 TURN 凭据。
     *
     * 对应 `GET /_matrix/client/v3/voip/turnServer/guest`。
     *
     * 服务未配置 TURN 时后端返回 404，访客被禁用时返回 403 —— 调用方需按错误处理，
     * 不要假设一定拿到凭据。
     *
     * @returns 访客 TURN 凭据（`username`/`password`/`uris`/`ttl`）
     * @example
     * ```typescript
     * const creds = await client.getTurnServerManager().getGuestTurnServerConfig();
     * console.log("TURN via", creds.uris?.join(", "));
     * ```
     */
    public async getGuestTurnServerConfig(): Promise<ITurnServerResponse> {
        return this.withRetry(async () => {
            return await this.request<ITurnServerResponse>({
                method: Method.Get,
                path: vp("/voip/turnServer/guest"),
                prefix: ClientPrefix.V3,
            });
        }, "getGuestTurnServerConfig");
    }

    public async getTurnServerURIs(): Promise<string[]> {
        const servers = this.getTurnServers();
        if (servers.length > 0) {
            return servers.flatMap((s) => s.urls);
        }
        // No cached servers, fetch from server
        try {
            const res: ITurnServerResponse = await this.client.turnServer();
            if (res.uris) {
                return res.uris;
            }
        } catch (error) {
            // No TURN servers available (VoIP unsupported, or the endpoint 404s on
            // homeservers without a TURN config). Degrade to an empty list rather than
            // throwing, but record the reason so the failure is not silent.
            logger.warn("TurnServerManager: failed to fetch TURN server URIs, returning empty list", error);
        }
        return [];
    }

    public getTurnServerExpiry(): number {
        return this.internalClient.turnServersExpiry ?? 0;
    }

    /**
     * Check TURN servers and refresh credentials if needed.
     * Emits TurnServers and TurnServersError events on the client.
     * @returns true if credentials are good, undefined if VoIP not supported.
     */
    public async checkTurnServers(): Promise<boolean | undefined> {
        const client = this.internalClient;
        if (!client.supportsVoip || !client.supportsVoip()) {
            return;
        }

        let credentialsGood = false;
        const remainingTime = client.turnServersExpiry - Date.now();
        if (remainingTime > TURN_CHECK_INTERVAL) {
            client.logger?.debug?.("TURN creds are valid for another " + remainingTime + " ms: not fetching new ones.");
            credentialsGood = true;
        } else {
            client.logger?.debug?.("Fetching new TURN credentials");
            try {
                const res: ITurnServerResponse = await client.turnServer();
                if (res.uris) {
                    client.logger?.debug?.("Got TURN URIs: " + res.uris + " refresh in " + res.ttl + " secs");
                    const servers: ITurnServer = {
                        urls: res.uris,
                        username: res.username,
                        credential: res.password,
                    };
                    client.turnServers = [servers];
                    client.turnServersExpiry = Date.now() + res.ttl * 1000;
                    credentialsGood = true;
                    client.emit(ClientEvent.TurnServers, client.turnServers);
                }
            } catch (err) {
                client.logger?.error?.("Failed to get TURN URIs", err);
                if ((err as HTTPError).httpStatus === 403) {
                    client.logger?.info?.("TURN access unavailable for this account: stopping credentials checks");
                    if (client.checkTurnServersIntervalID !== null) {
                        globalThis.clearInterval(client.checkTurnServersIntervalID);
                    }
                    client.checkTurnServersIntervalID = undefined;
                    client.emit(ClientEvent.TurnServersError, err as HTTPError, true);
                } else {
                    client.emit(ClientEvent.TurnServersError, err as Error, false);
                }
            }
        }

        return credentialsGood;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getTurnServerManager = function (): TurnServerManager {
        registerManagerClass("turnServer", TurnServerManager);
        return getOrCreateManager(this, "turnServer", () => new TurnServerManager(this));
    };
}
