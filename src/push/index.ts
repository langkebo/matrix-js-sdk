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
import { BaseManager } from "../managers/base-manager";
import { LRUCache, CacheRegistry } from "../utils/lru-cache";
import { AdminValidators } from "../admin/validators";
import { getOrCreateManager } from "../client-infra/manager-registry";
import type { PushPathPattern } from "./__generated__/route-table";
import { getRoomPushRuleRequest, setRoomMutePushRuleRequest } from "../client-push-rules";

export type { IPushRules } from "../@types/PushRules";
export { PUSHER_ENABLED } from "../@types/event";

type StripV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;

function pp<P extends StripV3<PushPathPattern>>(path: P): P {
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
    data?: Record<string, unknown>;
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
    data?: Record<string, unknown>;
    append?: boolean;
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

    constructor(client: MatrixClient) {
        super(client);

        this.pushersCache = new LRUCache<IPusher[]>({ maxSize: 10, ttl: 5 * 60 * 1000, name: "push-pushers" });
        this.pushRulesCache = new LRUCache<IPushRules>({ maxSize: 10, ttl: 5 * 60 * 1000, name: "push-rules" });
        CacheRegistry.getInstance().register(this.pushersCache);
        CacheRegistry.getInstance().register(this.pushRulesCache);
    }

    // ==================== Pushers ====================

    /**
     * 获取所有推送器
     * 对应 GET /_matrix/client/v3/pushers
     */
    async getPushers(forceRefresh = false): Promise<IPusher[]> {
        if (!forceRefresh) {
            const cached = this.pushersCache.get("pushers");
            if (cached) return cached;
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<{ pushers: IPusher[] }>(
                    Method.Get,
                    pp("/pushers"),
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "getPushers");

            let pushers = response?.pushers || [];

            // 兼容性处理
            const supportsRemoteToggle = await this.client.doesServerSupportUnstableFeature?.("org.matrix.msc3881");
            if (!supportsRemoteToggle) {
                pushers = pushers.map((pusher) => {
                    if (!pusher.hasOwnProperty(PUSHER_ENABLED.name)) {
                        (pusher as any)[PUSHER_ENABLED.name] = true;
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
     */
    async setPusher(pusher: IPusherRequest): Promise<void> {
        if (!pusher.pushkey) throw new InvalidParamError("pushkey is required");
        if (!pusher.app_id) throw new InvalidParamError("app_id is required");

        try {
            await this.withRetry(async () => {
                return await this.client.http.authedRequest(Method.Post, pp("/pushers/set"), undefined, pusher, {
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
     */
    async removePusher(pushkey: string, appId: string): Promise<void> {
        if (!pushkey) throw new InvalidParamError("pushkey is required");
        if (!appId) throw new InvalidParamError("appId is required");

        return this.setPusher({
            pushkey,
            app_id: appId,
            kind: null,
            app_display_name: "",
            device_display_name: "",
            lang: "",
        });
    }

    getCachedPushers(): IPusher[] {
        return this.pushersCache.get("pushers") || [];
    }

    // ==================== Push Rules ====================

    /**
     * 获取所有推送规则
     * 对应 GET /_matrix/client/v3/pushrules
     */
    async getPushRules(forceRefresh = false): Promise<IPushRules> {
        if (!forceRefresh) {
            const cached = this.pushRulesCache.get("pushRules");
            if (cached) return cached;
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IPushRules>(
                    Method.Get,
                    pp("/pushrules"),
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
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
     */
    async getPushRulesByScope(scope: string): Promise<IPushRuleSet> {
        if (!scope) throw new InvalidParamError("scope is required");
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<IPushRuleSet>(
                    Method.Get,
                    pp(`/pushrules/${encodeURIComponent(scope)}`),
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "getPushRulesByScope");
        } catch (error) {
            this.emit(PushEvent.PushError, this.normalizeError(error, "getPushRulesByScope"));
            throw this.normalizeError(error, "getPushRulesByScope");
        }
    }

    /**
     * 获取指定类型的推送规则
     * 对应 GET /_matrix/client/v3/pushrules/{scope}/{kind}
     */
    async getPushRulesByKind(scope: string, kind: PushRuleKind): Promise<IPushRule[]> {
        if (!scope) throw new InvalidParamError("scope is required");
        if (!kind) throw new InvalidParamError("kind is required");
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<any>(
                    Method.Get,
                    pp(`/pushrules/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}`),
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "getPushRulesByKind");

            return response?.[kind] || [];
        } catch (error) {
            this.emit(PushEvent.PushError, this.normalizeError(error, "getPushRulesByKind"));
            throw this.normalizeError(error, "getPushRulesByKind");
        }
    }

    /**
     * 获取特定推送规则
     * 对应 GET /_matrix/client/v3/pushrules/{scope}/{kind}/{rule_id}
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
                return await this.client.http.authedRequest<IPushRule>(
                    Method.Get,
                    pp(`/pushrules/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}/${encodeURIComponent(ruleId)}`),
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "getPushRule");
        } catch (error) {
            if (!throwOnError && (error as any).httpStatus === 404) return null;
            this.emit(PushEvent.PushError, this.normalizeError(error, "getPushRule"));
            throw this.normalizeError(error, "getPushRule");
        }
    }

    /**
     * 创建推送规则
     * 对应 POST /_matrix/client/v3/pushrules/{scope}/{kind}/{rule_id}
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
                return await this.client.http.authedRequest(
                    Method.Post,
                    pp(`/pushrules/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}/${encodeURIComponent(ruleId)}`),
                    undefined,
                    rule,
                    { prefix: ClientPrefix.V3 },
                );
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
                return await this.client.http.authedRequest(
                    Method.Put,
                    pp(`/pushrules/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}/${encodeURIComponent(ruleId)}`),
                    undefined,
                    rule,
                    { prefix: ClientPrefix.V3 },
                );
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
     */
    async deletePushRule(scope: string, kind: PushRuleKind, ruleId: string): Promise<void> {
        if (!scope || !kind || !ruleId) throw new InvalidParamError("scope, kind, and ruleId are required");
        try {
            await this.withRetry(async () => {
                return await this.client.http.authedRequest(
                    Method.Delete,
                    pp(`/pushrules/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}/${encodeURIComponent(ruleId)}`),
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
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
     */
    async getPushRuleEnabled(scope: string, kind: PushRuleKind, ruleId: string, throwOnError = true): Promise<boolean> {
        if (!scope || !kind || !ruleId) throw new InvalidParamError("scope, kind, and ruleId are required");
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<{ enabled: boolean }>(
                    Method.Get,
                    pp(
                        `/pushrules/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}/${encodeURIComponent(ruleId)}/enabled`,
                    ),
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "getPushRuleEnabled");

            return response?.enabled ?? true;
        } catch (error) {
            if (!throwOnError && (error as any).httpStatus === 404) return false;
            this.emit(PushEvent.PushError, this.normalizeError(error, "getPushRuleEnabled"));
            throw this.normalizeError(error, "getPushRuleEnabled");
        }
    }

    /**
     * 设置推送规则是否启用
     * 对应 PUT /_matrix/client/v3/pushrules/{scope}/{kind}/{rule_id}/enabled
     */
    async setPushRuleEnabled(scope: string, kind: PushRuleKind, ruleId: string, enabled: boolean): Promise<void> {
        if (!scope || !kind || !ruleId) throw new InvalidParamError("scope, kind, and ruleId are required");
        try {
            await this.withRetry(async () => {
                return await this.client.http.authedRequest(
                    Method.Put,
                    pp(
                        `/pushrules/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}/${encodeURIComponent(ruleId)}/enabled`,
                    ),
                    undefined,
                    { enabled },
                    { prefix: ClientPrefix.V3 },
                );
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
                return await this.client.http.authedRequest(
                    Method.Put,
                    pp(
                        `/pushrules/${encodeURIComponent(scope)}/${encodeURIComponent(kind)}/${encodeURIComponent(ruleId)}/actions`,
                    ),
                    undefined,
                    { actions },
                    { prefix: ClientPrefix.V3 },
                );
            }, "setPushRuleActions");

            this.pushRulesCache.delete("pushRules");
            await this.getPushRules(true);
        } catch (error) {
            this.emit(PushEvent.PushError, this.normalizeError(error, "setPushRuleActions"));
            throw this.normalizeError(error, "setPushRuleActions");
        }
    }

    getCachedPushRules(): IPushRules | null {
        return this.pushRulesCache.get("pushRules") || null;
    }

    // ==================== Notifications ====================

    /**
     * 获取推送通知列表
     * 对应 GET /_matrix/client/v3/notifications
     */
    async getNotifications(params?: { limit?: number; from?: string; only?: string }): Promise<INotificationsResponse> {
        try {
            const query: any = {};
            if (params?.limit !== undefined) query.limit = String(params.limit);
            if (params?.from) query.from = params.from;
            if (params?.only) query.only = params.only;

            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<INotificationsResponse>(
                    Method.Get,
                    pp("/notifications"),
                    query,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "getNotifications");
        } catch (error) {
            this.emit(PushEvent.PushError, this.normalizeError(error, "getNotifications"));
            throw this.normalizeError(error, "getNotifications");
        }
    }

    /**
     * 确认通知
     * 对应 POST /_matrix/client/v3/notifications/{notification_id}/ack
     */
    async ackNotification(notificationId: string, throwOnError = true): Promise<void> {
        if (!notificationId) throw new InvalidParamError("notificationId is required");
        try {
            await this.withRetry(async () => {
                return await this.client.http.authedRequest(
                    Method.Post,
                    pp(`/notifications/${encodeURIComponent(notificationId)}/ack`),
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            }, "ackNotification");
        } catch (error) {
            if (!throwOnError && (error as any).httpStatus === 404) return;
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

    async muteRoom(roomId: string): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        await this.createPushRule("global", PushRuleKind.RoomSpecific, roomId, {
            actions: [PushRuleActionName.DontNotify],
        });
    }

    async unmuteRoom(roomId: string): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        await this.deletePushRule("global", PushRuleKind.RoomSpecific, roomId);
    }

    async isRoomMuted(roomId: string): Promise<boolean> {
        AdminValidators.validateRoomId(roomId);
        try {
            const rules = await this.getPushRulesByKind("global", PushRuleKind.RoomSpecific);
            const rule = rules.find((r) => r.rule_id === roomId);
            return !!rule && rule.enabled && rule.actions.includes(PushRuleActionName.DontNotify);
        } catch {
            return false;
        }
    }

    async addKeywordHighlight(keyword: string): Promise<void> {
        if (!keyword) throw new InvalidParamError("keyword is required");
        await this.createPushRule("global", PushRuleKind.ContentSpecific, keyword, {
            actions: [PushRuleActionName.Notify, { set_tweak: "highlight", value: true } as any],
            pattern: keyword,
        });
    }

    async removeKeywordHighlight(keyword: string): Promise<void> {
        if (!keyword) throw new InvalidParamError("keyword is required");
        await this.deletePushRule("global", PushRuleKind.ContentSpecific, keyword);
    }

    async ignoreSender(userId: string): Promise<void> {
        if (!userId) throw new InvalidParamError("userId is required");
        await this.createPushRule("global", PushRuleKind.SenderSpecific, userId, {
            actions: [PushRuleActionName.DontNotify],
        });
    }

    async unignoreSender(userId: string): Promise<void> {
        if (!userId) throw new InvalidParamError("userId is required");
        await this.deletePushRule("global", PushRuleKind.SenderSpecific, userId);
    }

    // ==================== Lifecycle ====================

    async start(): Promise<void> {
        if (this.initialized) return;
        try {
            await Promise.all([this.getPushers(), this.getPushRules()]);
            this.initialized = true;
        } catch (e) {
            logger.warn("PushManager.start failed:", e);
        }
    }

    stop(): void {
        this.clearCache();
        this.initialized = false;
    }

    clearCache(): void {
        this.pushersCache.clear();
        this.pushRulesCache.clear();
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getPushManager(): PushManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getPushManager = function (): PushManager {
        return getOrCreateManager(this, "push", () => new PushManager(this));
    };
}

export default extendMatrixClient;
