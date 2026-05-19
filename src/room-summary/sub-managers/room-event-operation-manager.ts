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

import { MatrixClient } from "../../client";
import { Method } from "../../http-api/method";
import { Body } from "../../http-api/interface";
import type { QueryDict } from "../../utils";
import { encodeUri } from "../../utils";
import { InvalidParamError } from "../../common/errors";
import { RoomSummaryBaseManager, type RoomSummaryErrorCallback } from "../room-summary-base-manager";
import type {
    RoomNotificationsResult,
    RoomCapabilities,
    RoomSyncResult,
    RoomAccountDataResult,
    RoomInvitesResult,
    RoomReceiptsResult,
    TimelineResult,
    UnreadCountResult,
    RoomMetadata,
    RetentionPolicy,
    ExternalId,
    RoomSpace,
    EventPerspective,
    RoomPermissionsResult,
    RoomResolveResult,
    RoomMessageQueueResult,
    RoomServiceTypesResult,
    RoomReducedEventsResult,
    RoomRenderedResult,
    RoomFragmentsResult,
    RoomDeviceResult,
    RoomEventUrlResult,
    RoomTranslateResult,
    RoomConvertResult,
    RoomSignResult,
    RoomVerifyResult,
    TurnServerConfig,
    StickyEvent,
} from "../types";
import type { RoomSummaryPathPattern } from "../__generated__/route-table";

type StripClientV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;
function rsv<P extends StripClientV3<RoomSummaryPathPattern>>(path: P): P {
    return path;
}

/**
 * Room Event Operation Manager - 房间事件操作
 *
 * 处理通知、能力、同步、账户数据、邀请、回执、时间线、未读计数、
 * 元数据、vault 数据、保留策略、外部 ID、空间、事件视角、权限、
 * 解析、消息队列、服务类型、降采样事件、渲染、片段、设备、
 * 事件 URL、翻译、转换、签名、验证、TURN 服务器、sticky events、
 * power levels 等操作。
 * 无缓存、无事件。
 */
export class RoomSummaryEventOperationManager extends RoomSummaryBaseManager {
    private readonly onCacheInvalidation?: (roomId: string) => void;

    constructor(
        client: MatrixClient,
        onCacheInvalidation?: (roomId: string) => void,
        onError?: RoomSummaryErrorCallback,
    ) {
        super(client, onError);
        this.onCacheInvalidation = onCacheInvalidation;
    }

    /**
     * 获取房间通知列表
     *
     * @param roomId - 房间 ID
     * @param options - 分页选项
     */
    public async getRoomNotifications(
        roomId: string,
        options?: { from?: string; limit?: number; only?: string },
    ): Promise<RoomNotificationsResult> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            const queryParams: QueryDict = {};
            if (options?.from) queryParams.from = options.from;
            if (options?.limit !== undefined) queryParams.limit = String(options.limit);
            if (options?.only) queryParams.only = options.only;
            const result = await this.requestV3<RoomNotificationsResult>(
                Method.Get,
                this.roomSummaryPath("/rooms/$roomId/notifications", roomId),
                queryParams,
            );
            return {
                ...result,
                notifications: result.notifications.map((notification) => ({
                    ...notification,
                    type: notification.type ?? notification.notification_type,
                    timestamp: notification.timestamp ?? notification.ts,
                    read: notification.read ?? notification.is_read,
                    highlight: notification.highlight ?? false,
                })),
                next_batch: result.next_batch ?? result.next_token,
            };
        }, "getRoomNotifications");
    }

    /**
     * 获取房间能力
     *
     * @param roomId - 房间 ID
     */
    public async getRoomCapabilities(roomId: string): Promise<RoomCapabilities> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3<RoomCapabilities>(
                Method.Get,
                this.roomSummaryPath("/rooms/$roomId/capabilities", roomId),
            );
        }, "getRoomCapabilities");
    }

    /**
     * 获取房间级同步结果
     *
     * @param roomId - 房间 ID
     * @param options - 同步选项
     */
    public async getRoomSync(
        roomId: string,
        options?: { since?: string; timeout_ms?: number; filter?: string },
    ): Promise<RoomSyncResult> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            const queryParams: QueryDict = {};
            if (options?.since) queryParams.since = options.since;
            if (options?.timeout_ms !== undefined) queryParams.timeout_ms = String(options.timeout_ms);
            if (options?.filter) queryParams.filter = options.filter;
            return await this.requestV3(Method.Get, this.roomSummaryPath("/rooms/$roomId/sync", roomId), queryParams);
        }, "getRoomSync");
    }

    /**
     * 获取房间 account data
     *
     * @param roomId - 房间 ID
     * @param type - 数据类型
     */
    public async getRoomAccountData(roomId: string, type: string): Promise<RoomAccountDataResult> {
        this.validateRoomId(roomId);
        if (!type) throw new InvalidParamError("type is required");
        return await this.withRetry(async () => {
            return await this.requestV3(
                Method.Get,
                encodeUri("/rooms/$roomId/account_data/$type", { $roomId: roomId, $type: type }),
            );
        }, "getRoomAccountData");
    }

    /**
     * 设置房间 account data
     *
     * @param roomId - 房间 ID
     * @param type - 数据类型
     * @param content - 数据内容
     */
    public async setRoomAccountDataV3(
        roomId: string,
        type: string,
        content: Record<string, unknown>,
    ): Promise<RoomAccountDataResult> {
        this.validateRoomId(roomId);
        if (!type) throw new InvalidParamError("type is required");
        return await this.withRetry(async () => {
            return await this.requestV3(
                Method.Put,
                encodeUri("/rooms/$roomId/account_data/$type", { $roomId: roomId, $type: type }),
                undefined,
                content as Body,
            );
        }, "setRoomAccountDataV3");
    }

    /**
     * 获取房间邀请列表
     *
     * @param roomId - 房间 ID
     */
    public async getRoomInvites(roomId: string): Promise<RoomInvitesResult> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3(Method.Get, this.roomSummaryPath("/rooms/$roomId/invites", roomId));
        }, "getRoomInvites");
    }

    /**
     * 获取房间回执
     *
     * @param roomId - 房间 ID
     * @param receiptType - 回执类型
     * @param eventId - 事件 ID
     */
    public async getRoomReceipts(
        roomId: string,
        receiptType: string,
        eventId: string,
    ): Promise<RoomReceiptsResult> {
        this.validateRoomId(roomId);
        if (!receiptType) throw new InvalidParamError("receiptType is required");
        if (!eventId) throw new InvalidParamError("eventId is required");
        return await this.withRetry(async () => {
            return await this.requestV3(
                Method.Get,
                encodeUri("/rooms/$roomId/receipts/$receiptType/$eventId", {
                    $roomId: roomId,
                    $receiptType: receiptType,
                    $eventId: eventId,
                }),
            );
        }, "getRoomReceipts");
    }

    /**
     * 获取房间时间线
     *
     * @param roomId - 房间 ID
     * @param options - 时间线选项
     */
    public async getRoomTimeline(
        roomId: string,
        options?: { from?: string; to?: string; dir?: "f" | "b"; limit?: number; filter?: string },
    ): Promise<TimelineResult> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            const queryParams: QueryDict = {};
            if (options?.from) queryParams.from = options.from;
            if (options?.to) queryParams.to = options.to;
            if (options?.dir) queryParams.dir = options.dir;
            if (options?.limit !== undefined) queryParams.limit = String(options.limit);
            if (options?.filter) queryParams.filter = options.filter;
            return await this.requestV3(
                Method.Get,
                this.roomSummaryPath("/rooms/$roomId/timeline", roomId),
                queryParams,
            );
        }, "getRoomTimeline");
    }

    /**
     * 获取房间未读计数
     *
     * @param roomId - 房间 ID
     */
    public async getRoomUnreadCount(roomId: string): Promise<UnreadCountResult> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            const result = await this.requestV3<UnreadCountResult>(
                Method.Get,
                this.roomSummaryPath("/rooms/$roomId/unread_count", roomId),
            );
            return {
                ...result,
                room_id: result.room_id ?? roomId,
                unread_notifications: result.unread_notifications ?? result.notification_count,
                unread_highlight_count: result.unread_highlight_count ?? result.highlight_count,
            };
        }, "getRoomUnreadCount");
    }

    /**
     * 获取房间元数据
     *
     * @param roomId - 房间 ID
     */
    public async getRoomMetadata(roomId: string): Promise<RoomMetadata> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            const result = await this.requestV3<RoomMetadata>(
                Method.Get,
                this.roomSummaryPath("/rooms/$roomId/metadata", roomId),
            );
            return {
                ...result,
                created_at: result.created_at ?? result.created_ts,
                is_encrypted: result.is_encrypted ?? Boolean(result.encryption),
            };
        }, "getRoomMetadata");
    }

    /**
     * 获取房间 vault 数据
     *
     * @param roomId - 房间 ID
     */
    public async getRoomVaultData(roomId: string): Promise<Record<string, unknown> | null> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3(Method.Get, this.roomSummaryPath("/rooms/$roomId/vault_data", roomId));
        }, "getRoomVaultData");
    }

    /**
     * 设置房间 vault 数据
     *
     * @param roomId - 房间 ID
     * @param data - vault 数据
     */
    public async setRoomVaultData(roomId: string, data: Record<string, unknown>): Promise<void> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            await this.requestV3(
                Method.Put,
                this.roomSummaryPath("/rooms/$roomId/vault_data", roomId),
                undefined,
                data as Body,
            );
            this.onCacheInvalidation?.(roomId);
        }, "setRoomVaultData");
    }

    /**
     * 获取房间 retention 策略
     *
     * @param roomId - 房间 ID
     */
    public async getRoomRetention(roomId: string): Promise<RetentionPolicy | null> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3(Method.Get, this.roomSummaryPath("/rooms/$roomId/retention", roomId));
        }, "getRoomRetention");
    }

    /**
     * 获取房间外部关联 ID
     *
     * @param roomId - 房间 ID
     */
    public async getRoomExternalIds(roomId: string): Promise<ExternalId[]> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3(Method.Get, this.roomSummaryPath("/rooms/$roomId/external_ids", roomId));
        }, "getRoomExternalIds");
    }

    /**
     * 获取房间所属的 space 列表
     *
     * @param roomId - 房间 ID
     */
    public async getRoomSpaces(roomId: string): Promise<RoomSpace[]> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3(Method.Get, this.roomSummaryPath("/rooms/$roomId/spaces", roomId));
        }, "getRoomSpaces");
    }

    /**
     * 获取房间事件视角数据
     *
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     * @param options - 可选参数
     */
    public async getRoomEventPerspective(
        roomId: string,
        eventId: string,
        options?: { room_version?: string },
    ): Promise<EventPerspective> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            const queryParams: QueryDict = {};
            if (options?.room_version) queryParams.room_version = options.room_version;
            return await this.requestV3(Method.Get, this.roomSummaryPath("/rooms/$roomId/event_perspective", roomId), {
                ...queryParams,
                event_id: eventId,
            });
        }, "getRoomEventPerspective");
    }

    /**
     * 获取房间权限信息
     *
     * @param roomId - 房间 ID
     */
    public async getRoomPermissions(roomId: string): Promise<RoomPermissionsResult> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3(
                Method.Get,
                this.roomSummaryPath("/rooms/$roomId/permissions", roomId),
            );
        }, "getRoomPermissions");
    }

    /**
     * 获取房间解析信息
     *
     * @param roomId - 房间 ID
     */
    public async getRoomResolve(roomId: string): Promise<RoomResolveResult> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3(
                Method.Get,
                this.roomSummaryPath("/rooms/$roomId/resolve", roomId),
            );
        }, "getRoomResolve");
    }

    /**
     * 获取房间消息队列
     *
     * @param roomId - 房间 ID
     * @param options - 查询选项
     */
    public async getRoomMessageQueue(
        roomId: string,
        options?: { from?: string; limit?: number },
    ): Promise<RoomMessageQueueResult> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            const queryParams: QueryDict = {};
            if (options?.from) queryParams.from = options.from;
            if (options?.limit !== undefined) queryParams.limit = String(options.limit);
            return await this.requestV3(
                Method.Get,
                this.roomSummaryPath("/rooms/$roomId/message_queue", roomId),
                queryParams,
            );
        }, "getRoomMessageQueue");
    }

    /**
     * 获取房间服务类型
     *
     * @param roomId - 房间 ID
     */
    public async getRoomServiceTypes(roomId: string): Promise<RoomServiceTypesResult> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3(
                Method.Get,
                this.roomSummaryPath("/rooms/$roomId/service_types", roomId),
            );
        }, "getRoomServiceTypes");
    }

    /**
     * 获取房间降采样事件
     *
     * @param roomId - 房间 ID
     */
    public async getRoomReducedEvents(roomId: string): Promise<RoomReducedEventsResult> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3(
                Method.Get,
                this.roomSummaryPath("/rooms/$roomId/reduced_events", roomId),
            );
        }, "getRoomReducedEvents");
    }

    /**
     * 获取房间渲染结果
     *
     * @param roomId - 房间 ID
     */
    public async getRoomRendered(roomId: string): Promise<RoomRenderedResult> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3(
                Method.Get,
                this.roomSummaryPath("/rooms/$roomId/rendered/", roomId),
            );
        }, "getRoomRendered");
    }

    /**
     * 获取指定用户的房间片段
     *
     * @param roomId - 房间 ID
     * @param userId - 用户 ID
     */
    public async getRoomFragments(roomId: string, userId: string): Promise<RoomFragmentsResult> {
        this.validateRoomId(roomId);
        this.validateUserId(userId);
        return await this.withRetry(async () => {
            return await this.requestV3(
                Method.Get,
                encodeUri("/rooms/$roomId/fragments/$userId", {
                    $roomId: roomId,
                    $userId: userId,
                }),
            );
        }, "getRoomFragments");
    }

    /**
     * 获取房间设备视图
     *
     * @param roomId - 房间 ID
     * @param deviceId - 设备 ID
     */
    public async getRoomDevice(roomId: string, deviceId: string): Promise<RoomDeviceResult> {
        this.validateRoomId(roomId);
        if (!deviceId) {
            throw new InvalidParamError("deviceId is required");
        }
        return await this.withRetry(async () => {
            return await this.requestV3(
                Method.Get,
                encodeUri("/rooms/$roomId/device/$deviceId", {
                    $roomId: roomId,
                    $deviceId: deviceId,
                }),
            );
        }, "getRoomDevice");
    }

    /**
     * 获取房间事件的可访问 URL
     *
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     */
    public async getRoomEventUrl(roomId: string, eventId: string): Promise<RoomEventUrlResult> {
        this.validateRoomId(roomId);
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }
        return await this.withRetry(async () => {
            return await this.requestV3(
                Method.Get,
                encodeUri("/rooms/$roomId/event/$eventId/url", {
                    $roomId: roomId,
                    $eventId: eventId,
                }),
            );
        }, "getRoomEventUrl");
    }

    /**
     * 翻译房间事件
     *
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     * @param body - 翻译请求体，支持以下字段：
     *   - `target_lang`: 目标语言代码（如 "en", "zh", "ja"），默认使用后端配置
     *   - `source_lang`: 源语言代码（可选，不指定则自动检测）
     *   - `text`: 待翻译文本（可选，不指定则使用事件 body）
     */
    public async translateRoomEvent(
        roomId: string,
        eventId: string,
        body: Record<string, unknown> = {},
    ): Promise<RoomTranslateResult> {
        this.validateRoomId(roomId);
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }
        return await this.withRetry(async () => {
            return await this.requestV3(
                Method.Post,
                encodeUri("/rooms/$roomId/translate/$eventId", {
                    $roomId: roomId,
                    $eventId: eventId,
                }),
                undefined,
                body as Body,
            );
        }, "translateRoomEvent");
    }

    /**
     * 转换房间事件
     *
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     * @param body - 转换请求体
     */
    public async convertRoomEvent(
        roomId: string,
        eventId: string,
        body: Record<string, unknown> = {},
    ): Promise<RoomConvertResult> {
        this.validateRoomId(roomId);
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }
        return await this.withRetry(async () => {
            return await this.requestV3(
                Method.Post,
                encodeUri("/rooms/$roomId/convert/$eventId", {
                    $roomId: roomId,
                    $eventId: eventId,
                }),
                undefined,
                body as Body,
            );
        }, "convertRoomEvent");
    }

    /**
     * 签名房间事件
     *
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     * @param body - 签名请求体
     */
    public async signRoomEvent(
        roomId: string,
        eventId: string,
        body: Record<string, unknown> = {},
    ): Promise<RoomSignResult> {
        this.validateRoomId(roomId);
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }
        return await this.withRetry(async () => {
            return await this.requestV3(
                Method.Put,
                encodeUri("/rooms/$roomId/sign/$eventId", {
                    $roomId: roomId,
                    $eventId: eventId,
                }),
                undefined,
                body as Body,
            );
        }, "signRoomEvent");
    }

    /**
     * 验证房间事件
     *
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     * @param body - 验证请求体
     */
    public async verifyRoomEvent(
        roomId: string,
        eventId: string,
        body: Record<string, unknown> = {},
    ): Promise<RoomVerifyResult> {
        this.validateRoomId(roomId);
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }
        return await this.withRetry(async () => {
            return await this.requestV3(
                Method.Post,
                encodeUri("/rooms/$roomId/verify/$eventId", {
                    $roomId: roomId,
                    $eventId: eventId,
                }),
                undefined,
                body as Body,
            );
        }, "verifyRoomEvent");
    }

    /**
     * 获取房间 TURN 服务器配置
     *
     * @param roomId - 房间 ID
     */
    public async getRoomTurnServer(roomId: string): Promise<TurnServerConfig> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3(Method.Get, this.roomSummaryPath("/rooms/$roomId/turn_server", roomId));
        }, "getRoomTurnServer");
    }

    /**
     * 获取 sticky events
     *
     * @param roomId - 房间 ID
     */
    public async getStickyEvents(roomId: string): Promise<StickyEvent[]> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3(Method.Get, this.roomSummaryPath("/rooms/$roomId/sticky_events", roomId));
        }, "getStickyEvents");
    }

    /**
     * 设置 sticky event
     *
     * @param roomId - 房间 ID
     * @param eventType - 事件类型
     * @param content - 事件内容
     */
    public async setStickyEvent(
        roomId: string,
        eventType: string,
        content: Record<string, unknown>,
    ): Promise<StickyEvent> {
        this.validateRoomId(roomId);
        this.validateEventType(eventType);
        return await this.withRetry(async () => {
            const result = await this.requestV3<StickyEvent>(
                Method.Post,
                this.roomSummaryPath("/rooms/$roomId/sticky_events", roomId),
                undefined,
                { event_type: eventType, content } as Body,
            );
            this.onCacheInvalidation?.(roomId);
            return result;
        }, "setStickyEvent");
    }

    /**
     * 删除 sticky event
     *
     * @param roomId - 房间 ID
     * @param eventType - 事件类型
     */
    public async deleteStickyEvent(roomId: string, eventType: string): Promise<void> {
        this.validateRoomId(roomId);
        this.validateEventType(eventType);
        return await this.withRetry(async () => {
            await this.requestV3(
                Method.Delete,
                encodeUri("/rooms/$roomId/sticky_events/$eventType", { $roomId: roomId, $eventType: eventType }),
            );
            this.onCacheInvalidation?.(roomId);
        }, "deleteStickyEvent");
    }

    /**
     * 获取 m.room.power_levels
     *
     * @param roomId - 房间 ID
     */
    public async getRoomPowerLevels(roomId: string): Promise<RoomAccountDataResult> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3(
                Method.Get,
                this.roomSummaryPath("/rooms/$roomId/state/m.room.power_levels/", roomId),
            );
        }, "getRoomPowerLevels");
    }
}
