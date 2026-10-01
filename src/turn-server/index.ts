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
                path: "/voip/turnServer",
                prefix: ClientPrefix.V3,
            });
        }, "getTurnServerConfig");
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
