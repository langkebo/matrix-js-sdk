import { logger } from "../logger";
import { MatrixClient, type IProtocol } from "../client";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { Method } from "../http-api";
import { ClientPrefix } from "../http-api/prefix";
import type { ThirdpartyPathPattern } from "./__generated__/route-table";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { handleManagerError, type ErrorHandlingOptions } from "../error/index.js";
import type { QueryDict } from "../http-api/utils";
import * as utils from "../utils";
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
    fields: Record<string, string>;
    info?: {
        [key: string]: unknown;
    };
}

export interface ThirdPartyUser {
    userid: string;
    protocol: string;
    fields: Record<string, string>;
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
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * Get the third party protocols that can be reached using this HS.
     * GET /_matrix/client/v3/thirdparty/protocols
     */
    async getThirdpartyProtocols(): Promise<{ [protocol: string]: IProtocol }> {
        return this.withRetry(async () => {
            const response = await this.request<Record<string, IProtocol>>({
                method: Method.Get,
                path: tp("/thirdparty/protocols"),
                prefix: ClientPrefix.V3,
            });
            if (!response || typeof response !== "object") {
                throw new Error(`/thirdparty/protocols did not return an object: ${response}`);
            }
            return response;
        }, "getThirdpartyProtocols");
    }

    /**
     * Get third party locations for a protocol.
     * GET /_matrix/client/v3/thirdparty/location/{protocol}
     */
    getThirdpartyLocation(protocol: string, params?: { searchFields?: string[] }): Promise<ThirdPartyLocation[]> {
        const path = utils.encodeUri("/thirdparty/location/$protocol", { $protocol: protocol });
        return this.withRetry(async () => {
            return await this.request<ThirdPartyLocation[]>({
                method: Method.Get,
                path: path,
                queryParams: params as QueryDict,
                prefix: ClientPrefix.V3,
            });
        }, "getThirdpartyLocation");
    }

    /**
     * Get third party users for a protocol.
     * GET /_matrix/client/v3/thirdparty/user/{protocol}
     */
    getThirdpartyUser(protocol: string, params?: QueryDict): Promise<ThirdPartyUser[]> {
        const path = utils.encodeUri("/thirdparty/user/$protocol", { $protocol: protocol });
        return this.withRetry(async () => {
            return await this.request<ThirdPartyUser[]>({
                method: Method.Get,
                path: path,
                queryParams: params,
                prefix: ClientPrefix.V3,
            });
        }, "getThirdpartyUser");
    }

    /**
     * 获取支持的第三方协议
     *
     * @param options - 错误处理选项；传入 `boolean` 时等价于 `{ throwOnError }`（默认 `{}`，即抛出错误）
     * @returns 第三方协议数组，每项包含协议名 `protocol` 及协议详情；请求失败且 `throwOnError` 为 false 时返回空数组
     *
     * @example
     * ```typescript
     * // 获取 homeserver 支持的全部第三方协议
     * const protocols = await thirdPartyManager.getProtocols();
     * for (const protocol of protocols) {
     *     console.log(`${protocol.protocol}: ${protocol.icon}`);
     * }
     *
     * // 失败时不抛出错误，返回空数组
     * const safeProtocols = await thirdPartyManager.getProtocols({ throwOnError: false });
     * ```
     *
     * @throws {SDKError} 当请求失败且 `throwOnError` 为 true（默认）时
     */
    async getProtocols(options: ErrorHandlingOptions | boolean = {}): Promise<ThirdPartyProtocol[]> {
        try {
            const protocols = await this.getThirdpartyProtocols();
            return Object.entries(protocols).map(([name, data]) => ({
                ...data,
                protocol: name,
            }));
            // @swallow-error { owner: "thirdparty", expires: "2026-12-31" }
        } catch (e) {
            return handleManagerError<ThirdPartyProtocol[]>(e, options, "getProtocols") ?? [];
        }
    }

    /**
     * 获取指定第三方协议的详细信息
     *
     * @param protocol - 协议名称，取自 `getProtocols()` 返回项的 `protocol` 字段，例如 `"irc"`
     * @param options - 错误处理选项；传入 `boolean` 时等价于 `{ throwOnError }`（默认 `{}`，即抛出错误）
     * @returns 协议详情（包含协议名 `protocol`）；请求失败且 `throwOnError` 为 false 时返回 null
     *
     * @example
     * ```typescript
     * // 查询 irc 协议的字段定义
     * const protocol = await thirdPartyManager.getProtocol("irc");
     * if (protocol) {
     *     console.log(protocol.icon, protocol.location_fields);
     * }
     *
     * // 失败时返回 null 而不是抛出错误
     * const maybeProtocol = await thirdPartyManager.getProtocol("unknown", { throwOnError: false });
     * ```
     *
     * @throws {SDKError} 当请求失败且 `throwOnError` 为 true（默认）时
     */
    async getProtocol(
        protocol: string,
        options: ErrorHandlingOptions | boolean = {},
    ): Promise<ThirdPartyProtocol | null> {
        try {
            const data = await this.withRetry(async () => {
                return await this.request<IProtocol>({
                    method: Method.Get,
                    path: tp(`/thirdparty/protocol/${encodeURIComponent(protocol)}`),
                    prefix: ClientPrefix.V3,
                });
            }, "getProtocol");
            return {
                ...data,
                protocol,
            };
            // @swallow-error { owner: "thirdparty", expires: "2026-12-31" }
        } catch (e) {
            return handleManagerError<ThirdPartyProtocol>(e, options, "getProtocol");
        }
    }

    /**
     * 在指定第三方协议中按字段搜索位置
     *
     * @param protocol - 协议名称，例如 `"irc"`
     * @param params - 搜索字段键值对，字段名由该协议的 `location_fields` 定义，例如 `{ search_term: "Berlin" }`
     * @param throwOnError - 请求失败时是否抛出错误（默认 true；传 false 时记录警告并返回空数组）
     * @returns 匹配的第三方位置列表；失败且 `throwOnError` 为 false 时返回空数组
     *
     * @example
     * ```typescript
     * // 在 irc 协议中搜索名为 Berlin 的位置
     * const locations = await thirdPartyManager.searchLocations("irc", { search_term: "Berlin" });
     * for (const location of locations) {
     *     console.log(location.alias, location.fields);
     * }
     *
     * // 失败时返回空数组，不中断调用方
     * const safeLocations = await thirdPartyManager.searchLocations("irc", { search_term: "Berlin" }, false);
     * ```
     *
     * @throws {SdkError} 当请求失败且 `throwOnError` 为 true（默认）时
     */
    async searchLocations(
        protocol: string,
        params: ThirdPartySearchParams,
        throwOnError = true,
    ): Promise<ThirdPartyLocation[]> {
        try {
            return await this.getThirdpartyLocation(protocol, params);
            // @swallow-error { owner: "thirdparty", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw this.normalizeError(e, "searchLocations");
            }
            logger.warn("ThirdPartyManager.searchLocations failed:", e);
            return [];
        }
    }

    /**
     * 在指定第三方协议中按字段搜索用户
     *
     * @param protocol - 协议名称，例如 `"irc"`
     * @param params - 搜索字段键值对，字段名由该协议的 `user_fields` 定义，例如 `{ userid: "@alice:example.org" }`
     * @param throwOnError - 请求失败时是否抛出错误（默认 true；传 false 时记录警告并返回空数组）
     * @returns 匹配的第三方用户列表；失败且 `throwOnError` 为 false 时返回空数组
     *
     * @example
     * ```typescript
     * // 在 irc 协议中按用户 ID 搜索
     * const users = await thirdPartyManager.searchUsers("irc", { userid: "@alice:example.org" });
     * for (const user of users) {
     *     console.log(user.userid, user.display_name);
     * }
     *
     * // 失败时返回空数组，不中断调用方
     * const safeUsers = await thirdPartyManager.searchUsers("irc", { userid: "@alice:example.org" }, false);
     * ```
     *
     * @throws {SdkError} 当请求失败且 `throwOnError` 为 true（默认）时
     */
    async searchUsers(
        protocol: string,
        params: ThirdPartySearchParams,
        throwOnError = true,
    ): Promise<ThirdPartyUser[]> {
        try {
            return await this.getThirdpartyUser(protocol, params);
            // @swallow-error { owner: "thirdparty", expires: "2026-12-31" }
        } catch (e) {
            if (throwOnError) {
                throw this.normalizeError(e, "searchUsers");
            }
            logger.warn("ThirdPartyManager.searchUsers failed:", e);
            return [];
        }
    }

    /**
     * 在所有第三方协议中按字段搜索位置
     *
     * @param params - 搜索字段键值对，例如 `{ search_term: "Berlin" }`（默认 `{}`）
     * @param options - 错误处理选项；传入 `boolean` 时等价于 `{ throwOnError }`（默认 `{}`，即抛出错误）
     * @returns 匹配的第三方位置列表；请求失败且 `throwOnError` 为 false 时返回空数组
     *
     * @example
     * ```typescript
     * // 跨协议搜索位置
     * const locations = await thirdPartyManager.searchAllLocations({ search_term: "Berlin" });
     * console.log(`${locations.length} location(s) found`);
     *
     * // 失败时不抛出错误，返回空数组
     * const safeLocations = await thirdPartyManager.searchAllLocations({ search_term: "Berlin" }, false);
     * ```
     *
     * @throws {SDKError} 当请求失败且 `throwOnError` 为 true（默认）时
     */
    async searchAllLocations(
        params: ThirdPartySearchParams = {},
        options: ErrorHandlingOptions | boolean = {},
    ): Promise<ThirdPartyLocation[]> {
        try {
            return await this.withRetry(async () => {
                return await this.request<ThirdPartyLocation[]>({
                    method: Method.Get,
                    path: tp("/thirdparty/location"),
                    queryParams: params,
                    prefix: ClientPrefix.V3,
                });
            }, "searchAllLocations");
            // @swallow-error { owner: "thirdparty", expires: "2026-12-31" }
        } catch (e) {
            return handleManagerError<ThirdPartyLocation[]>(e, options, "searchAllLocations") ?? [];
        }
    }

    /**
     * 在所有第三方协议中按字段搜索用户
     *
     * @param params - 搜索字段键值对，例如 `{ search_term: "alice" }`（默认 `{}`）
     * @param options - 错误处理选项；传入 `boolean` 时等价于 `{ throwOnError }`（默认 `{}`，即抛出错误）
     * @returns 匹配的第三方用户列表；请求失败且 `throwOnError` 为 false 时返回空数组
     *
     * @example
     * ```typescript
     * // 跨协议搜索用户
     * const users = await thirdPartyManager.searchAllUsers({ search_term: "alice" });
     * console.log(`${users.length} user(s) found`);
     *
     * // 失败时不抛出错误，返回空数组
     * const safeUsers = await thirdPartyManager.searchAllUsers({ search_term: "alice" }, false);
     * ```
     *
     * @throws {SDKError} 当请求失败且 `throwOnError` 为 true（默认）时
     */
    async searchAllUsers(
        params: ThirdPartySearchParams = {},
        options: ErrorHandlingOptions | boolean = {},
    ): Promise<ThirdPartyUser[]> {
        try {
            return await this.withRetry(async () => {
                return await this.request<ThirdPartyUser[]>({
                    method: Method.Get,
                    path: tp("/thirdparty/user"),
                    queryParams: params,
                    prefix: ClientPrefix.V3,
                });
            }, "searchAllUsers");
            // @swallow-error { owner: "thirdparty", expires: "2026-12-31" }
        } catch (e) {
            return handleManagerError<ThirdPartyUser[]>(e, options, "searchAllUsers") ?? [];
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
        fields?: Record<string, unknown>; // Dynamic: parsed URI fields vary by type
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
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getThirdPartyManager = function (): ThirdPartyManager {
        registerManagerClass("thirdparty", ThirdPartyManager);
        return getOrCreateManager(this, "thirdparty", () => new ThirdPartyManager(this));
    };
}
