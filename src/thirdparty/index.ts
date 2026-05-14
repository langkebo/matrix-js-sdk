import { logger } from "../logger";
import { MatrixClient, type IProtocol } from "../client";
import { BaseManager } from "../managers/base-manager";
import { Method } from "../http-api";
import { ClientPrefix } from "../http-api/prefix";
import type { ThirdpartyPathPattern } from "./__generated__/route-table";
import { getOrCreateManager } from "../client-infra/manager-registry";
/*
Copyright 2024 The Matrix.org Foundation C.I.C.
*/

/**
 * ThirdParty Manager - 第三方服务管理
 *
 * 提供第三方协议和 bridges 管理功能
 */

export interface ThirdPartyProtocol extends IProtocol {
    protocol: string;
}

export interface ThirdPartyLocation {
    alias: string;
    protocol: string;
    fields: Record<string, unknown> | object;
    info?: {
        [key: string]: unknown;
    };
}

export interface ThirdPartyUser {
    userid: string;
    protocol: string;
    fields: Record<string, unknown> | object;
    display_name?: string;
    avatar_url?: string;
}

export interface ThirdPartySearchParams {
    [key: string]: string;
}

type StripV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;

function tp<P extends StripV3<ThirdpartyPathPattern>>(path: P): P {
    return path;
}

export class ThirdPartyManager extends BaseManager {
    constructor(client: MatrixClient) {
        super(client);
    }

    /**
     * 获取支持的第三方协议
     */
    async getProtocols(throwOnError = true): Promise<ThirdPartyProtocol[]> {
        try {
            const protocols = await this.client.getThirdpartyProtocols();
            return Object.entries(protocols).map(([name, data]) => ({
                ...data,
                protocol: name,
            }));
            // @swallow-error { owner: "thirdparty", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw this.normalizeError(e, "getProtocols");
            }
            logger.warn("ThirdPartyManager.getProtocols failed:", e);
            return [];
        }
    }

    async getProtocol(protocol: string, throwOnError = true): Promise<ThirdPartyProtocol | null> {
        try {
            const data = await this.client.http.authedRequest<IProtocol>(
                Method.Get,
                tp(`/thirdparty/protocol/${encodeURIComponent(protocol)}`),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            return {
                ...data,
                protocol,
            };
            // @swallow-error { owner: "thirdparty", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw this.normalizeError(e, "getProtocol");
            }
            logger.warn("ThirdPartyManager.getProtocol failed:", e);
            return null;
        }
    }

    async searchLocations(
        protocol: string,
        params: ThirdPartySearchParams,
        throwOnError = true,
    ): Promise<ThirdPartyLocation[]> {
        try {
            return await this.client.getThirdpartyLocation(protocol, params);
            // @swallow-error { owner: "thirdparty", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw this.normalizeError(e, "searchLocations");
            }
            logger.warn("ThirdPartyManager.searchLocations failed:", e);
            return [];
        }
    }

    async searchUsers(
        protocol: string,
        params: ThirdPartySearchParams,
        throwOnError = true,
    ): Promise<ThirdPartyUser[]> {
        try {
            return await this.client.getThirdpartyUser(protocol, params);
            // @swallow-error { owner: "thirdparty", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw this.normalizeError(e, "searchUsers");
            }
            logger.warn("ThirdPartyManager.searchUsers failed:", e);
            return [];
        }
    }

    async searchAllLocations(params: ThirdPartySearchParams = {}, throwOnError = true): Promise<ThirdPartyLocation[]> {
        try {
            return await this.client.http.authedRequest<ThirdPartyLocation[]>(
                Method.Get,
                tp("/thirdparty/location"),
                params,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            // @swallow-error { owner: "thirdparty", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw this.normalizeError(e, "searchAllLocations");
            }
            logger.warn("ThirdPartyManager.searchAllLocations failed:", e);
            return [];
        }
    }

    async searchAllUsers(params: ThirdPartySearchParams = {}, throwOnError = true): Promise<ThirdPartyUser[]> {
        try {
            return await this.client.http.authedRequest<ThirdPartyUser[]>(
                Method.Get,
                tp("/thirdparty/user"),
                params,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            // @swallow-error { owner: "thirdparty", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw this.normalizeError(e, "searchAllUsers");
            }
            logger.warn("ThirdPartyManager.searchAllUsers failed:", e);
            return [];
        }
    }

    /**
     * 获取位置别名信息
     */
    async getLocation(alias: string): Promise<ThirdPartyLocation | null> {
        try {
            // Matrix 协议中位置使用 room alias 格式
            const roomId = await this.client.getRoomIdForAlias(alias);
            if (roomId) {
                const room = this.client.getRoom(roomId.room_id);
                return {
                    alias,
                    protocol: "matrix",
                    fields: { room_id: roomId.room_id },
                    info: room
                        ? {
                              name: room.name,
                              topic: room.currentState
                                  .getStateEvents("m.room.topic", "")
                                  ?.getContent<{ topic?: string }>()?.topic,
                              avatar_url:
                                  room.getAvatarUrl(this.client.getHomeserverUrl(), 64, 64, "crop") || undefined,
                          }
                        : undefined,
                };
            }
            return null;
            // @swallow-error { owner: "thirdparty", expires: "2026-12-31" }
        } catch (e) {
            logger.warn("ThirdPartyManager.getLocation failed:", e);
            return null;
        }
    }

    /**
     * 获取用户信息
     */
    async getUser(userId: string): Promise<ThirdPartyUser | null> {
        try {
            // 检查是否是第三方用户
            if (userId.includes(":")) {
                const [localpart, server] = userId.split(":");
                // 尝试从协议获取用户
                return {
                    userid: userId,
                    protocol: "matrix",
                    fields: { localpart, server },
                };
            }
            return null;
            // @swallow-error { owner: "thirdparty", expires: "2026-12-31" }
        } catch (e) {
            logger.warn("ThirdPartyManager.getUser failed:", e);
            return null;
        }
    }

    /**
     * 解析第三方统一标识符
     */
    async parseMatrixUri(uri: string): Promise<{
        type: "user" | "room" | "event";
        id: string;
        fields?: Record<string, unknown>;
    } | null> {
        try {
            // 简单解析 matrix: URIs
            if (uri.startsWith("matrix:")) {
                const parts = uri.replace("matrix:", "").split("?");
                const path = parts[0];

                if (path.startsWith("u/")) {
                    return { type: "user", id: path.replace("u/", "") };
                } else if (path.startsWith("r/")) {
                    return { type: "room", id: path.replace("r/", "") };
                } else if (path.startsWith("e/")) {
                    const [roomId, eventId] = path.replace("e/", "").split("/");
                    return { type: "event", id: eventId, fields: { room_id: roomId } };
                }
            }
            return null;
            // @swallow-error { owner: "thirdparty", expires: "2026-12-31" }
        } catch (e) {
            logger.warn("ThirdPartyManager.parseMatrixUri failed:", e);
            return null;
        }
    }

    /**
     * 生成第三方统一标识符
     */
    encodeMatrixUri(type: "user" | "room" | "event", id: string, params?: Record<string, string>): string {
        let path = "";
        switch (type) {
            case "user":
                path = `u/${id}`;
                break;
            case "room":
                path = `r/${id}`;
                break;
            case "event":
                path = `e/${id}`;
                break;
        }

        let uri = `matrix:${path}`;
        if (params) {
            const query = Object.entries(params)
                .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
                .join("&");
            uri += "?" + query;
        }

        return uri;
    }

    start(): void {}
    stop(): void {}
}

declare module "../client.ts" {
    interface MatrixClient {
        getThirdPartyManager(): ThirdPartyManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getThirdPartyManager = function (): ThirdPartyManager {
        return getOrCreateManager(this, "thirdparty", () => new ThirdPartyManager(this));
    };
}

export default extendMatrixClient;
