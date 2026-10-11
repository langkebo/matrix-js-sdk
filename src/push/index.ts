/**
 * Push Manager - 推送管理
 *
 * 提供推送通知和推送规则管理功能。
 * 对应后端: synapse-rust/src/web/routes/push.rs
 *
 * 遵循 D7 契约驱动开发标准，100% 覆盖后端端点并保持类型对齐。
 */

import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { MatrixClient } from "../client";
import { InvalidParamError } from "../common/errors";
import { logger } from "../logger";
import {
    PushRuleKind,
    PushRuleAction,
    PushRuleActionName,
    IPushRule,
    IPushRules,
    PushRuleCondition,
} from "../@types/PushRules";
import { PUSHER_ENABLED } from "../@types/event";
import { type IEvent } from "../models/event";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { LRUCache, CacheRegistry } from "../utils/lru-cache";
import { validateRoomId } from "../common/validators";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import type { PushPath } from "./__generated__/route-table";
import { getRoomPushRuleRequest, setRoomMutePushRuleRequest } from "../client-push-rules";
import type { PathAssert, StripV3 } from "../http-api/strip-prefix";

export type { IPushRules } from "../@types/PushRules";
export { PUSHER_ENABLED } from "../@types/event";

function pp<const P extends string>(path: P & PathAssert<P, StripV3<PushPath>>): P {
    return path;
}

export enum PushEvent {
    PushersUpdated = "PushersUpdated",
    PushRulesUpdated = "PushRulesUpdated",
    NotificationReceived = "NotificationReceived",
    PushError = "PushError",
}

export interface IPusher {
    pushkey: string;
    kind: string | null;
    app_id: string;
    app_display_name: string;
    device_display_name: string;
    profile_tag?: string;
    lang: string;
    data?: Record<string, unknown>; // Dynamic: pusher data varies by kind (e.g. http, email)
    enabled?: boolean;
    device_id?: string;
}

export interface IPusherRequest {
    pushkey: string;
    kind?: string | null;
    app_id: string;
    app_display_name: string;
    device_display_name: string;
    profile_tag?: string;
    lang: string;
    data?: Record<string, unknown>; // Dynamic: pusher data varies by kind
    append?: boolean;
    /**
     * @deprecated Ignored. The backend binds the pusher to the access token's
     * device and rejects `device_id` in the request body (P2 #32).
     */
    device_id?: string;
}

export interface ICreatePushRuleRequest {
    actions: PushRuleAction[];
    conditions?: PushRuleCondition[];
    pattern?: string;
    before?: string;
    after?: string;
}

export interface IUpdatePushRuleRequest {
    actions: PushRuleAction[];
    conditions?: PushRuleCondition[];
    pattern?: string;
}

export interface INotification {
    event_id: string;
    room_id: string;
    ts: number;
    profile_tag?: string;
    read: boolean;
    event?: IEvent;
}

export interface INotificationsResponse {
    notifications: INotification[];
    next_token?: string;
}

export interface IPushRuleSet {
    override?: IPushRule[];
    content?: IPushRule[];
    room?: IPushRule[];
    sender?: IPushRule[];
    underride?: IPushRule[];
}

interface PushManagerEventMap {
    [PushEvent.PushersUpdated]: (pushers: IPusher[]) => void;
    [PushEvent.PushRulesUpdated]: (rules: IPushRules) => void;
    [PushEvent.NotificationReceived]: (notification: INotification) => void;
    [PushEvent.PushError]: (error: Error) => void;
}

/**
 * PushManager 处理推送器和推送规则。
 * 对应后端 `push.rs` 中的所有 REST 端点。
 */
export class PushManager extends BaseManager<PushEvent, PushManagerEventMap> {
    private pushersCache: LRUCache<IPusher[]>;
    private pushRulesCache: LRUCache<IPushRules>;
    private initialized: boolean = false;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);

        this.pushersCache = new LRUCache<IPusher[]>({ maxSize: 10, ttl: 5 * 60 * 1000, name: "push-pushers" });
        this.pushRulesCache = new LRUCache<IPushRules>({ maxSize: 10, ttl: 5 * 60 * 1000, name: "push-rules" });
        CacheRegistry.getInstance().register(this.pushersCache);
        CacheRegistry.getInstance().register(this.pushRulesCache);
    }

    // ==================== Pushers ====================

    /**
     * 获取所有推送器
     * 对应 GET /_matrix/client/v3/pushers
     * @param forceRefresh - 为 true 时跳过缓存，强制重新拉取。
     * @returns 当前账号的全部推送器。
     * @throws 请求失败时抛出规范化后的错误。
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * const pushers = await push.getPushers();
     * ```
     */
    async getPushers(forceRefresh = false): Promise<IPusher[]> {
        if (!forceRefresh) {
            const cached = this.pushersCache.get("pushers");
            if (cached) return cached;
        }

        try {
            const response = await this.request<{ pushers: IPusher[] }>({
                method: Method.Get,
                path: pp("/pushers"),
                prefix: ClientPrefix.V3,
            });

            let pushers = response?.pushers || [];

            // 兼容性处理
            const supportsRemoteToggle = await this.client.doesServerSupportUnstableFeature?.("org.matrix.msc3881");
            if (!supportsRemoteToggle) {
                pushers = pushers.map((pusher) => {
                    if (!pusher.hasOwnProperty(PUSHER_ENABLED.name)) {
                        (pusher as unknown as Record<string, unknown>) /* Dynamic: adding unstable feature property */[
                            PUSHER_ENABLED.name
                        ] = true;
                    }
                    return pusher;
                });
            }

            this.pushersCache.set("pushers", pushers);
            this.emit(PushEvent.PushersUpdated, pushers);
            return pushers;
        } catch (error) {
            this.emit(PushEvent.PushError, this.normalizeError(error, "getPushers"));
            throw this.normalizeError(error, "getPushers");
        }
    }

    /**
     * 设置推送器
     * 对应 POST /_matrix/client/v3/pushers/set
     * @param pusher - 推送器配置（pushkey / app_id 为必填）。
     * @throws 缺少 pushkey 或 app_id，或请求失败时抛出错误。
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * await push.setPusher({
     *     pushkey: "key",
     *     app_id: "com.example.app",
     *     app_display_name: "Example",
     *     device_display_name: "Phone",
     *     lang: "en",
     * });
     * ```
     */
    async setPusher(pusher: IPusherRequest): Promise<void> {
        if (!pusher.pushkey) throw new InvalidParamError("pushkey is required");
        if (!pusher.app_id) throw new InvalidParamError("app_id is required");

        // P2 #32: the backend binds the pusher to the *access token's* device
        // (`auth_user.device_id`) and rejects the field in the body
        // (`SetPusherRequest` uses `#[serde(deny_unknown_fields)]`). Never
        // forward `device_id` over the wire — a caller-supplied one would 400.
        const { device_id: _ignoredDeviceId, ...body } = pusher;

        try {
            await this.withRetry(async () => {
                return await this.request({
                    method: Method.Post,
                    path: pp("/pushers/set"),
                    body,
                    prefix: ClientPrefix.V3,
                });
            }, "setPusher");

            this.pushersCache.delete("pushers");
            await this.getPushers(true);
        } catch (error) {
            this.emit(PushEvent.PushError, this.normalizeError(error, "setPusher"));
            throw this.normalizeError(error, "setPusher");
        }
    }

    /**
     * 移除推送器
     * 对应 POST /_matrix/client/v3/pushers/set (kind=null)
     * @param pushkey - 推送器唯一键。
     * @param appId - 应用 ID。
     * @param deviceId - 已废弃，后端按访问令牌绑定设备。
     * @throws 缺少 pushkey 或 appId，或请求失败时抛出错误。
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * await push.removePusher("key", "com.example.app");
     * ```
     */
    async removePusher(pushkey: string, appId: string, deviceId?: string): Promise<void> {
        if (!pushkey) throw new InvalidParamError("pushkey is required");
        if (!appId) throw new InvalidParamError("appId is required");

        return this.setPusher({
            pushkey,
            app_id: appId,
            kind: null,
            app_display_name: "",
            device_display_name: "",
            lang: "",
            device_id: deviceId || "",
        });
    }

    /**
     * 获取缓存的推送器（不会发起网络请求）。
     * @returns 缓存的推送器列表；无缓存时返回空数组。
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * const cached = push.getCachedPushers();
     * ```
     */
    getCachedPushers(): IPusher[] {
        return this.pushersCache.get("pushers") || [];
    }

    // ==================== Push Rules ====================

    /**
     * 获取所有推送规则
     * 对应 GET /_matrix/client/v3/pushrules
     * @param forceRefresh - 为 true 时跳过缓存，强制重新拉取。
     * @returns 当前账号的完整推送规则集合。
     * @throws 请求失败时抛出规范化后的错误。
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * const rules = await push.getPushRules();
     * ```
     */
    async getPushRules(forceRefresh = false): Promise<IPushRules> {
        if (!forceRefresh) {
            const cached = this.pushRulesCache.get("pushRules");
            if (cached) return cached;
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.request<IPushRules>({
                    method: Method.Get,
                    path: pp("/pushrules"),
                    prefix: ClientPrefix.V3,
                });
            }, "getPushRules");

            this.pushRulesCache.set("pushRules", response);
            this.emit(PushEvent.PushRulesUpdated, response);
            return response;
        } catch (error) {
            this.emit(PushEvent.PushError, this.normalizeError(error, "getPushRules"));
            throw this.normalizeError(error, "getPushRules");
        }
    }

    /**
     * 获取指定作用域的推送规则
     * 对应 GET /_matrix/client/v3/pushrules/{scope}
     * @param scope - 作用域，例如 "global" 或 "device"。
     * @returns 该作用域下按 kind 分组的推送规则集合。
     * @throws scope 为空或请求失败时抛出错误。
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * const rules = await push.getPushRulesByScope("global");
     * ```
     */
    async getPushRulesByScope(scope: string): Promise<IPushRuleSet> {
        if (!scope) throw new InvalidParamError("scope is required");
        try {
            return await this.withRetry(async () => {
                return await this.request<IPushRuleSet>({
                    method: Method.Get,
                    path: pp(`/pushrules/${encodeURIComponent(scope)}`),
                    prefix: ClientPrefix.V3,
                });
            }, "getPushRulesByScope");
        } catch (error) {
            this.emit(PushEvent.PushError, this.normalizeError(error, "getPushRulesByScope"));
            throw this.normalizeError(error, "getPushRulesByScope");
        }
    }

    /**
     * 获取指定类型的推送规则
     * 对应 GET /_matrix/client/v3/pushrules/{scope}/{kind}
     * @param scope - 作用域，例如 "global" 或 "device"。
     * @param kind - 规则类型。
     * @returns 匹配的推送规则列表。
     * @throws scope/kind 为空或请求失败时抛出错误。
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * const rules = await push.getPushRulesByKind("global", "room");
     * ```
     */
    async getPushRulesByKind(scope: string, kind: PushRuleKind): Promise<IPushRule[]> {
        if (!scope) throw new InvalidParamError("scope is required");
        if (!kind) throw new InvalidParamError("kind is required");
        try {
            const response = await this.request<Record<string, IPushRule[]>>({
                method: Method.Get,
                path: pp(`/pushrules/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}`),
                prefix: ClientPrefix.V3,
            });

            return response?.[kind] || [];
        } catch (error) {
            this.emit(PushEvent.PushError, this.normalizeError(error, "getPushRulesByKind"));
            throw this.normalizeError(error, "getPushRulesByKind");
        }
    }

    /**
     * 获取特定推送规则
     * 对应 GET /_matrix/client/v3/pushrules/{scope}/{kind}/{rule_id}
     * @param scope - 作用域，例如 "global" 或 "device"。
     * @param kind - 规则类型。
     * @param ruleId - 规则 ID。
     * @param throwOnError - 为 false 时，404 返回 null 而非抛错。
     * @returns 命中的推送规则；未找到且 throwOnError 为 false 时返回 null。
     * @throws 参数为空，或请求失败且允许抛错时抛出错误。
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * const rule = await push.getPushRule("global", "room", "!room:example.org");
     * ```
     */
    async getPushRule(
        scope: string,
        kind: PushRuleKind,
        ruleId: string,
        throwOnError = true,
    ): Promise<IPushRule | null> {
        if (!scope || !kind || !ruleId) throw new InvalidParamError("scope, kind, and ruleId are required");
        try {
            return await this.withRetry(async () => {
                return await this.request<IPushRule>({
                    method: Method.Get,
                    path: pp(
                        `/pushrules/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}/${encodeURIComponent(ruleId)}`,
                    ),
                    prefix: ClientPrefix.V3,
                });
            }, "getPushRule");
            // @swallow-error { owner: "push", expires: "2026-12-31" }
        } catch (error) {
            if (!throwOnError && (error as { httpStatus?: number }).httpStatus === 404) return null;
            this.emit(PushEvent.PushError, this.normalizeError(error, "getPushRule"));
            throw this.normalizeError(error, "getPushRule");
        }
    }

    /**
     * 创建推送规则
     * 对应 POST /_matrix/client/v3/pushrules/{scope}/{kind}/{rule_id}
     * @param scope - 作用域，例如 "global" 或 "device"。
     * @param kind - 规则类型。
     * @param ruleId - 规则 ID。
     * @param rule - 规则内容（actions 必填）。
     * @throws 参数为空、actions 缺失或请求失败时抛出错误。
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * await push.createPushRule("global", "room", "!room:example.org", {
     *     actions: ["dont_notify"],
     * });
     * ```
     */
    async createPushRule(
        scope: string,
        kind: PushRuleKind,
        ruleId: string,
        rule: ICreatePushRuleRequest,
    ): Promise<void> {
        if (!scope || !kind || !ruleId) throw new InvalidParamError("scope, kind, and ruleId are required");
        if (!rule.actions || rule.actions.length === 0) throw new InvalidParamError("actions are required");

        try {
            await this.withRetry(async () => {
                return await this.request({
                    method: Method.Post,
                    path: pp(
                        `/pushrules/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}/${encodeURIComponent(ruleId)}`,
                    ),
                    body: rule,
                    prefix: ClientPrefix.V3,
                });
            }, "createPushRule");

            this.pushRulesCache.delete("pushRules");
            await this.getPushRules(true);
        } catch (error) {
            this.emit(PushEvent.PushError, this.normalizeError(error, "createPushRule"));
            throw this.normalizeError(error, "createPushRule");
        }
    }

    /**
     * 更新推送规则
     * 对应 PUT /_matrix/client/v3/pushrules/{scope}/{kind}/{rule_id}
     * @param scope - 作用域，例如 "global" 或 "device"。
     * @param kind - 规则类型。
     * @param ruleId - 规则 ID。
     * @param rule - 要更新的规则内容。
     * @throws 参数为空或请求失败时抛出错误。
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * await push.updatePushRule("global", "room", "!room:example.org", {
     *     actions: ["notify"],
     * });
     * ```
     */
    async updatePushRule(
        scope: string,
        kind: PushRuleKind,
        ruleId: string,
        rule: IUpdatePushRuleRequest,
    ): Promise<void> {
        if (!scope || !kind || !ruleId) throw new InvalidParamError("scope, kind, and ruleId are required");

        try {
            await this.withRetry(async () => {
                return await this.request({
                    method: Method.Put,
                    path: pp(
                        `/pushrules/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}/${encodeURIComponent(ruleId)}`,
                    ),
                    body: rule,
                    prefix: ClientPrefix.V3,
                });
            }, "updatePushRule");

            this.pushRulesCache.delete("pushRules");
            await this.getPushRules(true);
        } catch (error) {
            this.emit(PushEvent.PushError, this.normalizeError(error, "updatePushRule"));
            throw this.normalizeError(error, "updatePushRule");
        }
    }

    /**
     * 删除推送规则
     * 对应 DELETE /_matrix/client/v3/pushrules/{scope}/{kind}/{rule_id}
     * @param scope - 作用域，例如 "global" 或 "device"。
     * @param kind - 规则类型。
     * @param ruleId - 规则 ID。
     * @throws 参数为空或请求失败时抛出错误。
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * await push.deletePushRule("global", "room", "!room:example.org");
     * ```
     */
    async deletePushRule(scope: string, kind: PushRuleKind, ruleId: string): Promise<void> {
        if (!scope || !kind || !ruleId) throw new InvalidParamError("scope, kind, and ruleId are required");
        try {
            await this.withRetry(async () => {
                return await this.request({
                    method: Method.Delete,
                    path: pp(
                        `/pushrules/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}/${encodeURIComponent(ruleId)}`,
                    ),
                    prefix: ClientPrefix.V3,
                });
            }, "deletePushRule");

            this.pushRulesCache.delete("pushRules");
            await this.getPushRules(true);
        } catch (error) {
            this.emit(PushEvent.PushError, this.normalizeError(error, "deletePushRule"));
            throw this.normalizeError(error, "deletePushRule");
        }
    }

    /**
     * 获取推送规则是否启用
     * 对应 GET /_matrix/client/v3/pushrules/{scope}/{kind}/{rule_id}/enabled
     * @param scope - 作用域，例如 "global" 或 "device"。
     * @param kind - 规则类型。
     * @param ruleId - 规则 ID。
     * @param throwOnError - 为 false 时，404 返回 false 而非抛错。
     * @returns 规则是否启用。
     * @throws 参数为空，或请求失败且允许抛错时抛出错误。
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * const enabled = await push.getPushRuleEnabled("global", "room", "!room:example.org");
     * ```
     */
    async getPushRuleEnabled(scope: string, kind: PushRuleKind, ruleId: string, throwOnError = true): Promise<boolean> {
        if (!scope || !kind || !ruleId) throw new InvalidParamError("scope, kind, and ruleId are required");
        try {
            const response = await this.withRetry(async () => {
                return await this.request<{ enabled: boolean }>({
                    method: Method.Get,
                    path: pp(
                        `/pushrules/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}/${encodeURIComponent(ruleId)}/enabled`,
                    ),
                    prefix: ClientPrefix.V3,
                });
            }, "getPushRuleEnabled");

            return response?.enabled ?? true;
            // @swallow-error { owner: "push", expires: "2026-12-31" }
        } catch (error) {
            if (!throwOnError && (error as { httpStatus?: number }).httpStatus === 404) return false;
            this.emit(PushEvent.PushError, this.normalizeError(error, "getPushRuleEnabled"));
            throw this.normalizeError(error, "getPushRuleEnabled");
        }
    }

    /**
     * 设置推送规则是否启用
     * 对应 PUT /_matrix/client/v3/pushrules/{scope}/{kind}/{rule_id}/enabled
     * @param scope - 作用域，例如 "global" 或 "device"。
     * @param kind - 规则类型。
     * @param ruleId - 规则 ID。
     * @param enabled - 是否启用该规则。
     * @throws 参数为空或请求失败时抛出错误。
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * await push.setPushRuleEnabled("global", "room", "!room:example.org", false);
     * ```
     */
    async setPushRuleEnabled(scope: string, kind: PushRuleKind, ruleId: string, enabled: boolean): Promise<void> {
        if (!scope || !kind || !ruleId) throw new InvalidParamError("scope, kind, and ruleId are required");
        try {
            await this.withRetry(async () => {
                return await this.request({
                    method: Method.Put,
                    path: pp(
                        `/pushrules/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}/${encodeURIComponent(ruleId)}/enabled`,
                    ),
                    body: { enabled },
                    prefix: ClientPrefix.V3,
                });
            }, "setPushRuleEnabled");

            this.pushRulesCache.delete("pushRules");
            await this.getPushRules(true);
        } catch (error) {
            this.emit(PushEvent.PushError, this.normalizeError(error, "setPushRuleEnabled"));
            throw this.normalizeError(error, "setPushRuleEnabled");
        }
    }

    /**
     * 设置推送规则动作
     * 对应 PUT /_matrix/client/v3/pushrules/{scope}/{kind}/{rule_id}/actions
     * @param scope - 作用域，例如 "global" 或 "device"。
     * @param kind - 规则类型。
     * @param ruleId - 规则 ID。
     * @param actions - 要设置的动作列表（不能为空）。
     * @throws 参数为空、actions 缺失或请求失败时抛出错误。
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * await push.setPushRuleActions("global", "room", "!room:example.org", ["dont_notify"]);
     * ```
     */
    async setPushRuleActions(
        scope: string,
        kind: PushRuleKind,
        ruleId: string,
        actions: PushRuleAction[],
    ): Promise<void> {
        if (!scope || !kind || !ruleId) throw new InvalidParamError("scope, kind, and ruleId are required");
        if (!actions || actions.length === 0) throw new InvalidParamError("actions are required");
        try {
            await this.withRetry(async () => {
                return await this.request({
                    method: Method.Put,
                    path: pp(
                        `/pushrules/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}/${encodeURIComponent(ruleId)}/actions`,
                    ),
                    body: { actions },
                    prefix: ClientPrefix.V3,
                });
            }, "setPushRuleActions");

            this.pushRulesCache.delete("pushRules");
            await this.getPushRules(true);
        } catch (error) {
            this.emit(PushEvent.PushError, this.normalizeError(error, "setPushRuleActions"));
            throw this.normalizeError(error, "setPushRuleActions");
        }
    }

    /**
     * 获取缓存的推送规则（不会发起网络请求）。
     * @returns 缓存的推送规则；无缓存时返回 null。
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * const cached = push.getCachedPushRules();
     * ```
     */
    getCachedPushRules(): IPushRules | null {
        return this.pushRulesCache.get("pushRules") || null;
    }

    // ==================== Notifications ====================

    /**
     * 获取推送通知列表
     * 对应 GET /_matrix/client/v3/notifications
     * @param params - 可选过滤/分页参数（limit、from、only）。
     * @returns 通知列表与下一页令牌。
     * @throws 请求失败时抛出规范化后的错误。
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * const { notifications } = await push.getNotifications({ limit: 20 });
     * ```
     */
    async getNotifications(params?: { limit?: number; from?: string; only?: string }): Promise<INotificationsResponse> {
        try {
            const query: Record<string, string> = {};
            if (params?.limit !== undefined) query.limit = String(params.limit);
            if (params?.from) query.from = params.from;
            if (params?.only) query.only = params.only;

            return await this.request<INotificationsResponse>({
                method: Method.Get,
                path: pp("/notifications"),
                queryParams: query,
                prefix: ClientPrefix.V3,
            });
        } catch (error) {
            this.emit(PushEvent.PushError, this.normalizeError(error, "getNotifications"));
            throw this.normalizeError(error, "getNotifications");
        }
    }

    /**
     * 确认通知
     * 对应 POST /_matrix/client/v3/notifications/{notification_id}/ack
     * @param notificationId - 通知 ID。
     * @param throwOnError - 为 false 时，404 静默返回而非抛错。
     * @throws notificationId 为空，或请求失败且允许抛错时抛出错误。
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * await push.ackNotification("notification-id");
     * ```
     */
    async ackNotification(notificationId: string, throwOnError = true): Promise<void> {
        if (!notificationId) throw new InvalidParamError("notificationId is required");
        try {
            await this.withRetry(async () => {
                return await this.request({
                    method: Method.Post,
                    path: pp(`/notifications/${encodeURIComponent(notificationId)}/ack`),
                    prefix: ClientPrefix.V3,
                });
            }, "ackNotification");
        } catch (error) {
            if (!throwOnError && (error as { httpStatus?: number }).httpStatus === 404) return;
            this.emit(PushEvent.PushError, this.normalizeError(error, "ackNotification"));
            throw this.normalizeError(error, "ackNotification");
        }
    }

    // ==================== Convenience Methods ====================

    /**
     * Get the room-kind push rule associated with a room.
     * @param scope - "global" or device-specific.
     * @param roomId - the id of the room.
     * @returns the rule or undefined.
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * const rule = push.getRoomPushRule("global", "!room:example.org");
     * ```
     */
    getRoomPushRule(scope: "global" | "device", roomId: string): IPushRule | undefined {
        return getRoomPushRuleRequest(this.client.pushRules, scope, roomId);
    }

    /**
     * Set a room-kind muting push rule in a room.
     * The operation also updates MatrixClient.pushRules at the end.
     * @param scope - "global" or device-specific.
     * @param roomId - the id of the room.
     * @param mute - the mute state.
     * @returns Promise which resolves: result object
     * @returns Rejects: with an error response.
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * await push.setRoomMutePushRule("global", "!room:example.org", true);
     * ```
     */
    setRoomMutePushRule(scope: "global" | "device", roomId: string, mute: boolean): Promise<void> | undefined {
        const roomPushRule = this.getRoomPushRule(scope, roomId);
        return setRoomMutePushRuleRequest(
            scope,
            roomId,
            mute,
            roomPushRule,
            () => this.client.getPushManager(),
            (rules) => {
                this.client.pushRules = rules;
            },
        );
    }

    /**
     * 将房间设为静音（创建 room 类型的 DontNotify 推送规则）。
     * @param roomId - 房间 ID。
     * @returns 静音规则创建完成。
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * await push.muteRoom("!room:example.org");
     * ```
     */
    async muteRoom(roomId: string): Promise<void> {
        validateRoomId(roomId);
        await this.createPushRule("global", PushRuleKind.RoomSpecific, roomId, {
            actions: [PushRuleActionName.DontNotify],
        });
    }

    /**
     * 取消房间静音（删除对应的 room 推送规则）。
     * @param roomId - 房间 ID。
     * @returns 静音规则删除完成。
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * await push.unmuteRoom("!room:example.org");
     * ```
     */
    async unmuteRoom(roomId: string): Promise<void> {
        validateRoomId(roomId);
        await this.deletePushRule("global", PushRuleKind.RoomSpecific, roomId);
    }

    /**
     * 判断房间是否处于静音状态。
     * @param roomId - 房间 ID。
     * @returns 房间已静音返回 true，否则返回 false。
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * const muted = await push.isRoomMuted("!room:example.org");
     * ```
     */
    async isRoomMuted(roomId: string): Promise<boolean> {
        validateRoomId(roomId);
        try {
            const rules = await this.getPushRulesByKind("global", PushRuleKind.RoomSpecific);
            const rule = rules.find((r) => r.rule_id === roomId);
            return !!rule && rule.enabled && rule.actions.includes(PushRuleActionName.DontNotify);
        } catch (e) {
            logger.warn("PushManager.isRoomMuted failed:", e);
        }
        return false;
    }

    /**
     * 添加关键词高亮规则。
     * @param keyword - 要高亮的关键词。
     * @returns 高亮规则创建完成。
     * @throws keyword 为空时抛出错误。
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * await push.addKeywordHighlight("urgent");
     * ```
     */
    async addKeywordHighlight(keyword: string): Promise<void> {
        if (!keyword) throw new InvalidParamError("keyword is required");
        await this.createPushRule("global", PushRuleKind.ContentSpecific, keyword, {
            actions: [
                PushRuleActionName.Notify,
                { set_tweak: "highlight", value: true } as import("../@types/PushRules").TweakHighlight,
            ],
            pattern: keyword,
        });
    }

    /**
     * 移除关键词高亮规则。
     * @param keyword - 要移除的关键词。
     * @returns 高亮规则删除完成。
     * @throws keyword 为空时抛出错误。
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * await push.removeKeywordHighlight("urgent");
     * ```
     */
    async removeKeywordHighlight(keyword: string): Promise<void> {
        if (!keyword) throw new InvalidParamError("keyword is required");
        await this.deletePushRule("global", PushRuleKind.ContentSpecific, keyword);
    }

    /**
     * 忽略某个发送者（创建 sender 类型的 DontNotify 规则）。
     * @param userId - 要忽略的用户 ID。
     * @returns 忽略规则创建完成。
     * @throws userId 为空时抛出错误。
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * await push.ignoreSender("@alice:example.org");
     * ```
     */
    async ignoreSender(userId: string): Promise<void> {
        if (!userId) throw new InvalidParamError("userId is required");
        await this.createPushRule("global", PushRuleKind.SenderSpecific, userId, {
            actions: [PushRuleActionName.DontNotify],
        });
    }

    /**
     * 取消忽略某个发送者（删除对应的 sender 规则）。
     * @param userId - 要取消忽略的用户 ID。
     * @returns 忽略规则删除完成。
     * @throws userId 为空时抛出错误。
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * await push.unignoreSender("@alice:example.org");
     * ```
     */
    async unignoreSender(userId: string): Promise<void> {
        if (!userId) throw new InvalidParamError("userId is required");
        await this.deletePushRule("global", PushRuleKind.SenderSpecific, userId);
    }

    // ==================== Lifecycle ====================

    // 进行中的 start() Promise：并发调用复用同一份初始化（FT-115）
    private startPromise: Promise<void> | null = null;

    /**
     * 启动 PushManager，预热推送器与推送规则缓存。
     * @returns 初始化完成；并发调用会复用同一次初始化。
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * await push.start();
     * ```
     */
    async start(): Promise<void> {
        if (this.initialized) return;
        if (this.startPromise) {
            return this.startPromise;
        }
        this.startPromise = (async () => {
            try {
                await Promise.all([this.getPushers(), this.getPushRules()]);
                this.initialized = true;
            } catch (e) {
                logger.warn("PushManager.start failed:", e);
                // 本轮初始化失败：清空 promise 让下次重试；成功路径由 initialized 持续守卫。
                this.startPromise = null;
            }
        })();
        return this.startPromise;
    }

    /**
     * 停止 PushManager，清空缓存并重置初始化状态。
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * push.stop();
     * ```
     */
    stop(): void {
        this.clearCache();
        this.initialized = false;
    }

    /**
     * 清空推送器与推送规则缓存。
     * @example
     * ```typescript
     * const push = client.getPushManager();
     * push.clearCache();
     * ```
     */
    clearCache(): void {
        this.pushersCache.clear();
        this.pushRulesCache.clear();
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getPushManager = function (): PushManager {
        registerManagerClass("push", PushManager);
        return getOrCreateManager(this, "push", () => new PushManager(this));
    };
}
