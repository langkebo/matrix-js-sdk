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

import { MatrixClient, ClientEvent } from "../client";
import { Room } from "../models/room";
import { Method } from "../http-api/method";
import { ClientPrefix, MediaPrefix, VendorPrefix } from "../http-api/prefix";
import { MatrixError } from "../http-api/errors";
import { type EmptyObject } from "../@types/common";
import {
    type ICreateRoomOpts,
    type IJoinRoomOpts,
    type KnockRoomOpts,
    type InviteOpts,
    type ITagsResponse,
    type IGuestAccessOpts,
    type IContextResponse,
} from "../@types/requests";
import { type RoomAccountDataEvents, EventType } from "../@types/event";
import { type IContent } from "../models/event";
import { type IRoomEventFilter } from "../filter";
import { InvalidParamError } from "../common/errors";
import { validateRoomId, validateUserId } from "../common/validators";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import * as utils from "../utils";
import { logger } from "../logger";
import { KnownMembership } from "../@types/membership";
import { IThirdPartySigned, IJoinRequestBody, ITagMetadata, IRoomHierarchy } from "../client-internal-types";
import { IRoomInitialSyncResponse, type IPreviewUrlResponse } from "../client-api-types";
import { QueryDict } from "../http-api/utils";
import { SyncApi } from "../sync";
import { searchRoomsRequest } from "../client-secure-backup-requests";
import type { Body, IRequestOpts } from "../http-api/interface";
import { LRUCache } from "../utils/lru-cache";
import { InflightRequestCache } from "../utils/inflight-request-cache";
import { Visibility, GuestAccess, HistoryVisibility } from "../@types/partials";
import { doesClientAdvertiseSynapseRustFeature, SynapseRustFeature } from "../server-capabilities";
import * as ContentHelpers from "../content-helpers";
import { beginRoomPeek, endRoomPeek } from "../client-room-peek";
import type { InviteRequest } from "./__generated__/dto";
import type { RoomPath } from "./__generated__/route-table";
import type { AuthPath } from "../auth/__generated__/route-table";
import type { TagsPath } from "../tags/__generated__/route-table";
import type { SlidingSyncPath } from "../sliding-sync/__generated__/route-table";
// 跨模块归属：以下两条路由由别的后端模块注册，但调用点在 RoomManager。
//   - `/rooms/{room_id}/context/{event_id}` → ledger `registered_by: "search"`
//   - `/rooms/{room_id}/report`            → ledger `registered_by: "moderation"`
// 断言必须落在**真正拥有该路由的契约**上，否则精确匹配会（正确地）拒绝它。
import type { SearchPath } from "../search/__generated__/route-table";
import type { ModerationPath } from "../moderation/__generated__/route-table";
import type { MSC3575SlidingSyncRequest, MSC3575SlidingSyncResponse } from "../sliding-sync";
import type { PathAssert, StripR0, StripSimplifiedSlidingSync, StripV1, StripV3 } from "../http-api/strip-prefix";

export enum RoomEvent {
    RoomCreated = "RoomCreated",
    RoomJoined = "RoomJoined",
    RoomLeft = "RoomLeft",
    MemberJoined = "MemberJoined",
    MemberLeft = "MemberLeft",
    StateChanged = "StateChanged",
    Error = "Error",
}

export interface IRoomEvent {
    content: IContent;
    type: string;
    event_id: string;
    sender: string;
    origin_server_ts: number;
    room_id?: string;
    unsigned?: IContent;
}

export interface IStateEvent extends IRoomEvent {
    state_key: string;
}

export interface IRoomVersionResponse {
    room_version: string;
}

export interface RoomCapabilities {
    [capabilityName: string]: {
        enabled?: boolean;
        [key: string]: unknown;
    };
}

export interface IRoomCapabilitiesResponse {
    capabilities: RoomCapabilities;
}

export interface IRoomMetadataResponse {
    room_id: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    join_rule?: string;
    history_visibility?: string;
    guest_access?: string;
    created_ts?: number;
}

export interface IGetMembersResponse {
    chunk: IStateEvent[];
}

export interface IJoinedMembersResponse {
    joined: {
        [userId: string]: {
            display_name?: string;
            avatar_url?: string;
        };
    };
}

export interface IGetMessagesResponse {
    chunk: IRoomEvent[];
    start: string;
    end?: string;
    state?: IStateEvent[];
}

export interface ISendEventResponse {
    event_id: string;
    room_id?: string;
}

export interface IEventContextResponse {
    event: IRoomEvent;
    events_before: IRoomEvent[];
    events_after: IRoomEvent[];
    start: string;
    end: string;
    state: IStateEvent[];
}

export interface IMyRoom {
    membership?: string;
    join_state?: string;
    [key: string]: unknown;
}

export interface IMyRoomsResponse {
    rooms: IMyRoom[];
    total: number;
}

/**
 * `GET /user/{user_id}/rooms` 的响应。
 *
 * 注意：后端只允许查询**自己**（`user_id` 与认证用户不一致时返回 403 `Access denied`）。
 */
export interface IUserRoomsResponse {
    /** Room IDs the user has joined. */
    joined_rooms: string[];
}

/**
 * `GET /user/mutual_rooms` 的响应（MSC2666 **v1 稳定版**）。
 *
 * 与 `ServerCapabilities._unstable_getSharedRooms` 返回的结构一致，便于上层统一处理分页。
 */
export interface IMutualRoomsResponse {
    /** Room IDs joined by both the caller and the target user. */
    joined: string[];
    /** Opaque token for the next page; absent when there are no more rooms. */
    next_batch_token?: string;
}

interface RoomManagerEventMap {
    [RoomEvent.RoomCreated]: (roomId: string) => void;
    [RoomEvent.RoomJoined]: (roomId: string) => void;
    [RoomEvent.RoomLeft]: (roomId: string) => void;
    [RoomEvent.MemberJoined]: (roomId: string, userId: string) => void;
    [RoomEvent.MemberLeft]: (roomId: string, userId: string) => void;
    [RoomEvent.StateChanged]: (roomId: string, eventType: string, stateKey: string) => void;
    [RoomEvent.Error]: (error: Error) => void;
}

type RoomInfoCacheEntry =
    | IRoomVersionResponse
    | IRoomCapabilitiesResponse
    | IRoomMetadataResponse
    | IJoinedMembersResponse;

type RoomManagerPath =
    | StripR0<RoomPath | TagsPath>
    | StripV1<RoomPath | SearchPath>
    | StripV3<RoomPath | TagsPath | AuthPath | SearchPath | ModerationPath>
    | StripSimplifiedSlidingSync<SlidingSyncPath>;

function rp<const P extends string>(path: P & PathAssert<P, RoomManagerPath>): P {
    return path;
}

export class RoomManager extends BaseManager<RoomEvent, RoomManagerEventMap> {
    private roomInfoCache: LRUCache<RoomInfoCacheEntry>;
    private membersCache: LRUCache<IStateEvent[]>;
    private stateCache: LRUCache<IStateEvent[]>;
    private peekSync: SyncApi | null = null;
    private readonly urlPreviewRequestCache: InflightRequestCache<IPreviewUrlResponse>;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);

        this.roomInfoCache = new LRUCache<RoomInfoCacheEntry>(100, 5 * 60 * 1000);
        this.membersCache = new LRUCache<IStateEvent[]>(100, 2 * 60 * 1000);
        this.stateCache = new LRUCache<IStateEvent[]>(50, 5 * 60 * 1000);
        this.urlPreviewRequestCache = new InflightRequestCache<IPreviewUrlResponse>(client.urlPreviewCache);
    }

    // ==================== Room Info ====================

    public getRoom(roomId: string | undefined): Room | null {
        return this.client.store.getRoom(roomId!);
    }

    public getRooms(): Room[] {
        return this.client.store.getRooms();
    }

    public getVisibleRooms(_msc3946ProcessDynamicPredecessor = false): Room[] {
        // Implementation moved from MatrixClient
        const rooms = this.client.store.getRooms();
        return rooms.filter((room) => {
            const myMembership = room.getMyMembership();
            return myMembership === KnownMembership.Join || myMembership === KnownMembership.Invite;
        });
    }

    public async getRoomVersion(roomId: string, forceRefresh = false): Promise<string> {
        validateRoomId(roomId);

        const cacheKey = `version:${roomId}`;
        if (!forceRefresh) {
            const cached = this.roomInfoCache.get(cacheKey);
            if (cached && "room_version" in cached && typeof cached.room_version === "string") {
                return cached.room_version;
            }
        }

        const response = await this.withRetry(async () => {
            return await this.request<IRoomVersionResponse>({
                method: Method.Get,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/version`),
                prefix: ClientPrefix.V3,
            });
        });

        this.roomInfoCache.set(cacheKey, { room_version: response.room_version });
        return response.room_version;
    }

    public async getRoomCapabilities(roomId: string, forceRefresh = false): Promise<IRoomCapabilitiesResponse> {
        validateRoomId(roomId);

        const cacheKey = `capabilities:${roomId}`;
        if (!forceRefresh) {
            const cached = this.roomInfoCache.get(cacheKey);
            if (cached && "capabilities" in cached) {
                return cached;
            }
        }

        const response = await this.withRetry(async () => {
            return await this.request<IRoomCapabilitiesResponse>({
                method: Method.Get,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/capabilities`),
                prefix: ClientPrefix.V3,
            });
        });

        this.roomInfoCache.set(cacheKey, response);
        return response;
    }

    public async getRoomMetadata(roomId: string, forceRefresh = false): Promise<IRoomMetadataResponse> {
        validateRoomId(roomId);

        const cacheKey = `metadata:${roomId}`;
        if (!forceRefresh) {
            const cached = this.roomInfoCache.get(cacheKey);
            if (cached && "room_id" in cached) {
                return cached;
            }
        }

        const response = await this.withRetry(async () => {
            return await this.request<IRoomMetadataResponse>({
                method: Method.Get,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/metadata`),
                prefix: ClientPrefix.V3,
            });
        });

        this.roomInfoCache.set(cacheKey, response);
        return response;
    }

    // ==================== Room Lifecycle ====================

    public async createRoom(options: ICreateRoomOpts): Promise<{ room_id: string }> {
        const invitesNeedingToken = (options.invite_3pid || []).filter(
            (i: { id_access_token?: string }) => !i.id_access_token,
        );
        if (invitesNeedingToken.length > 0 && this.client.identityServer?.getAccessToken) {
            const identityAccessToken = await this.client.identityServer.getAccessToken();
            if (identityAccessToken) {
                for (const invite of invitesNeedingToken) {
                    (invite as { id_access_token?: string }).id_access_token = identityAccessToken;
                }
            }
        }

        const response = await this.withRetry(async () => {
            return await this.request<{ room_id: string }>({
                method: Method.Post,
                path: rp("/createRoom"),
                body: options,
                prefix: ClientPrefix.V3,
            });
        });

        this.emit(RoomEvent.RoomCreated, response.room_id);
        return response;
    }

    /**
     * 创建**私聊房间**（fork 私有快捷入口）。
     *
     * 对应 `POST /_matrix/client/v3/rooms/create_private`。
     *
     * 后端会强制 `preset = "private_chat"`、`visibility = "private"` 后委托给与
     * `createRoom()` 相同的实现，因此这里**不接受** `preset`/`visibility` 覆盖——传了也会被后端改写。
     * 返回结构与 `createRoom()` 一致，并同样触发 {@link RoomEvent.RoomCreated}。
     *
     * @param options - 其余建房选项（`invite`、`name`、`topic`、`initial_state` 等）
     * @returns 新房间的 `room_id`
     */
    public async createPrivateRoom(
        options: Omit<ICreateRoomOpts, "preset" | "visibility"> = {},
    ): Promise<{ room_id: string }> {
        const response = await this.withRetry(async () => {
            return await this.request<{ room_id: string }>({
                method: Method.Post,
                path: rp("/rooms/create_private"),
                body: options,
                prefix: ClientPrefix.V3,
            });
        }, "createPrivateRoom");

        this.emit(RoomEvent.RoomCreated, response.room_id);
        return response;
    }

    public async joinRoom(roomIdOrAlias: string, opts: IJoinRoomOpts = {}): Promise<Room> {
        const room = this.getRoom(roomIdOrAlias);
        const roomMember = room?.getMember(this.client.getSafeUserId());
        const preJoinMembership = roomMember?.membership;

        const inviter =
            preJoinMembership == KnownMembership.Invite ? (roomMember?.events.member?.getSender() ?? null) : null;

        logger.debug(
            `joinRoom[${roomIdOrAlias}]: preJoinMembership=${preJoinMembership}, inviter=${inviter}, opts=${JSON.stringify(opts)}`,
        );
        if (preJoinMembership == KnownMembership.Join) return room!;

        let signPromise: Promise<IThirdPartySigned | void> = Promise.resolve();

        if (opts.inviteSignUrl) {
            const url = new URL(opts.inviteSignUrl);
            url.searchParams.set("mxid", this.client.credentials.userId!);
            signPromise = this.client.http.requestOtherUrl<IThirdPartySigned>(Method.Post, url);
        }

        const queryParams: Record<string, string | string[]> = {};
        if (opts.viaServers) {
            queryParams.via = queryParams.server_name = opts.viaServers.slice(0, 3);
        }

        const data: IJoinRequestBody = {};
        const signedInviteObj = await signPromise;
        if (signedInviteObj) {
            data.third_party_signed = signedInviteObj;
        }

        const path = rp(`/join/${encodeURIComponent(roomIdOrAlias)}`);
        const res = await this.request<{ room_id: string }>({
            method: Method.Post,
            path: path,
            queryParams: queryParams,
            body: data,
            prefix: ClientPrefix.V3,
        });

        const roomId = res.room_id;
        const cryptoBackend = this.client.getCryptoBackend();
        if (opts.acceptSharedHistory && inviter && cryptoBackend) {
            const bundleDownloaded = await cryptoBackend.maybeAcceptKeyBundle(roomId, inviter);
            if (!bundleDownloaded) {
                cryptoBackend.markRoomAsPendingKeyBundle(roomId, inviter);
            }
        }

        const resolvedRoom = this.getRoom(roomId);
        if (resolvedRoom?.hasMembershipState(this.client.getSafeUserId(), KnownMembership.Join)) return resolvedRoom;

        const syncApi = new SyncApi(this.client, this.client.getClientOpts(), this.client.getSyncApiOptions());
        return syncApi.createRoom(roomId);
    }

    public async knockRoom(roomIdOrAlias: string, opts: KnockRoomOpts = {}): Promise<{ room_id: string }> {
        const room = this.getRoom(roomIdOrAlias);
        if (room?.hasMembershipState(this.client.getSafeUserId(), KnownMembership.Knock)) {
            return { room_id: room.roomId };
        }

        const path = rp(`/knock/${encodeURIComponent(roomIdOrAlias)}`);

        const queryParams: Record<string, string | string[]> = {};
        if (opts.viaServers) {
            const viaServers = Array.isArray(opts.viaServers) ? opts.viaServers.slice(0, 3) : [opts.viaServers];
            queryParams.server_name = viaServers;
            queryParams.via = viaServers;
        }

        const body: Record<string, string> = {};
        if (opts.reason) {
            body.reason = opts.reason;
        }

        return this.withRetry(
            async () => {
                return await this.request({
                    method: Method.Post,
                    path: path,
                    queryParams: queryParams,
                    body: body,
                    prefix: ClientPrefix.V3,
                });
            },
            { label: "knockRoom", idempotent: false },
        );
    }

    /**
     * Leave a room.
     *
     * @param roomId - The room ID to leave.
     * @param opts.forget - When `true`, the server forgets the room as part of leaving
     *     (MSC4267: `POST /rooms/{roomId}/leave` with body `{ forget: true }`), so the client
     *     need not issue a separate `/forget` request. The local store entry is dropped here too.
     *     Defaults to `false` for backwards compatibility with servers that have not enabled
     *     MSC4267 (they ignore the field and the client can still call `forget()` explicitly).
     */
    public async leave(roomId: string, opts?: { forget?: boolean }): Promise<EmptyObject> {
        validateRoomId(roomId);
        const forget = opts?.forget ?? false;

        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Post,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/leave`),
                body: forget ? { forget: true } : {},
                prefix: ClientPrefix.V3,
            });
        });

        this.emit(RoomEvent.RoomLeft, roomId);
        this.clearRoomCache(roomId);
        if (forget) {
            // Server has already forgotten the room (MSC4267); mirror that locally so a
            // redundant /forget call is avoided.
            this.client.store?.removeRoom?.(roomId);
        }
        return response;
    }

    public async forget(roomId: string, deleteRoom = true): Promise<EmptyObject> {
        validateRoomId(roomId);

        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Post,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/forget`),
                body: { delete_room: deleteRoom },
                prefix: ClientPrefix.V3,
            });
        });

        if (deleteRoom) {
            this.client.store.removeRoom(roomId);
            this.client.emit(ClientEvent.DeleteRoom, roomId);
        }

        this.clearRoomCache(roomId);
        return response;
    }

    // ==================== Members ====================

    public async getMembers(
        roomId: string,
        params?: {
            membership?: string;
            not_membership?: string;
            at?: string;
        },
        forceRefresh = false,
    ): Promise<IStateEvent[]> {
        validateRoomId(roomId);

        if (!forceRefresh && !params) {
            const cached = this.membersCache.get(`members:${roomId}`);
            if (cached) {
                return cached;
            }
        }

        const response = await this.withRetry(async () => {
            return await this.request<IGetMembersResponse>({
                method: Method.Get,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/members`),
                queryParams: params as Record<string, string>,
                prefix: ClientPrefix.V3,
            });
        });

        if (!params) {
            this.membersCache.set(`members:${roomId}`, response.chunk);
        }
        return response.chunk;
    }

    public async getJoinedMembers(roomId: string, forceRefresh = false): Promise<IJoinedMembersResponse> {
        validateRoomId(roomId);

        const cacheKey = `joined_members:${roomId}`;
        if (!forceRefresh) {
            const cached = this.roomInfoCache.get(cacheKey);
            if (cached && "joined" in cached) {
                return cached;
            }
        }

        const response = await this.withRetry(async () => {
            return await this.request<IJoinedMembersResponse>({
                method: Method.Get,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/joined_members`),
                prefix: ClientPrefix.V3,
            });
        });

        this.roomInfoCache.set(cacheKey, response);
        return response;
    }

    /**
     * Get user membership in a room
     *
     * @param roomId - room ID
     * @param userId - user ID
     * @param throwOnError - Whether to throw on error (default true, pass false to keep compatibility fallback)
     * @returns membership event
     */
    public async getMembership(roomId: string, userId: string, throwOnError = true): Promise<IStateEvent | null> {
        validateRoomId(roomId);
        validateUserId(userId);

        try {
            const response = await this.withRetry(async () => {
                return await this.request<IStateEvent>({
                    method: Method.Get,
                    path: rp(`/rooms/${encodeURIComponent(roomId)}/membership/${encodeURIComponent(userId)}`),
                    prefix: ClientPrefix.V3,
                });
            });

            return response;
            // @swallow-error { owner: "room", expires: "2026-12-31" }
        } catch (error: unknown) {
            if (throwOnError) {
                throw error;
            }
            const err = error as Record<string, unknown>; /* Dynamic: error shape varies by source */
            const httpStatus = err?.httpStatus as number | undefined;
            if (httpStatus === 404) {
                return null;
            }
            throw error;
        }
    }

    // ==================== Member Actions ====================

    public async invite(roomId: string, userId: string, opts: InviteOpts | string = {}): Promise<EmptyObject> {
        validateRoomId(roomId);
        validateUserId(userId);

        const normalizedOpts = typeof opts === "string" ? { reason: opts } : opts;

        if (normalizedOpts.shareEncryptedHistory) {
            await this.client.getCrypto()?.shareRoomHistoryWithUser(roomId, userId);
        }

        const body: InviteRequest = {
            user_id: userId,
            ...(normalizedOpts.reason ? { reason: normalizedOpts.reason } : {}),
        };

        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Post,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/invite`),
                body: body,
                prefix: ClientPrefix.V3,
            });
        });

        this.membersCache.delete(`members:${roomId}`);
        this.emit(RoomEvent.MemberJoined, roomId, userId);
        return response;
    }

    public async inviteByEmail(roomId: string, email: string): Promise<EmptyObject> {
        return this.inviteByThreePid(roomId, "email", email);
    }

    public async inviteByThreePid(roomId: string, medium: string, address: string): Promise<EmptyObject> {
        validateRoomId(roomId);
        const identityAccessToken = this.client.identityServer?.getAccessToken
            ? await this.client.identityServer.getAccessToken()
            : undefined;

        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Post,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/invite`),
                body: {
                    id_server: this.client.getIdentityServerManager().getIdentityServerUrl(true),
                    id_access_token: identityAccessToken,
                    medium,
                    address,
                },
                prefix: ClientPrefix.V3,
            });
        });

        return response;
    }

    public async kick(roomId: string, userId: string, reason?: string): Promise<EmptyObject> {
        validateRoomId(roomId);
        validateUserId(userId);

        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Post,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/kick`),
                body: { user_id: userId, reason },
                prefix: ClientPrefix.V3,
            });
        });

        this.membersCache.delete(`members:${roomId}`);
        this.emit(RoomEvent.MemberLeft, roomId, userId);
        return response;
    }

    public async ban(roomId: string, userId: string, reason?: string): Promise<EmptyObject> {
        validateRoomId(roomId);
        validateUserId(userId);

        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Post,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/ban`),
                body: { user_id: userId, reason },
                prefix: ClientPrefix.V3,
            });
        });

        this.membersCache.delete(`members:${roomId}`);
        return response;
    }

    public async unban(roomId: string, userId: string): Promise<EmptyObject> {
        validateRoomId(roomId);
        validateUserId(userId);

        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Post,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/unban`),
                body: { user_id: userId },
                prefix: ClientPrefix.V3,
            });
        });

        this.membersCache.delete(`members:${roomId}`);
        return response;
    }

    // ==================== Messages ====================

    // getMessages method has been moved to EventManager

    // ==================== State ====================

    public async getState(roomId: string, forceRefresh = false): Promise<IStateEvent[]> {
        return this.client.getEventManager().getState(roomId, forceRefresh);
    }

    public async getStateEvent(roomId: string, eventType: string, stateKey = ""): Promise<IContent> {
        return this.client.getEventManager().getStateEvent(roomId, eventType, stateKey);
    }

    public async sendStateEvent(
        roomId: string,
        eventType: string,
        content: IContent,
        stateKey = "",
    ): Promise<ISendEventResponse> {
        return this.client.getEventManager().sendStateEvent(roomId, eventType, content, stateKey);
    }

    public setRoomName(roomId: string, name: string): Promise<ISendEventResponse> {
        return this.client.sendStateEvent(roomId, "m.room.name", { name }, "");
    }

    public setRoomTopic(roomId: string, topic?: string, htmlTopic?: string): Promise<ISendEventResponse> {
        const content = ContentHelpers.makeTopicContent(topic, htmlTopic);
        return this.client.sendStateEvent(roomId, EventType.RoomTopic, content, undefined);
    }

    // ==================== Events ====================

    public async getEvent(roomId: string, eventId: string): Promise<IRoomEvent> {
        validateRoomId(roomId);
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }

        const response = await this.withRetry(async () => {
            return await this.request<IRoomEvent>({
                method: Method.Get,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`),
                prefix: ClientPrefix.V3,
            });
        });

        return response;
    }

    public async getEventContext(
        roomId: string,
        eventId: string,
        params?: { limit?: number; filter?: IRoomEventFilter },
    ): Promise<IContextResponse> {
        validateRoomId(roomId);
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }

        const queryParams: Record<string, string> = {};
        if (params?.limit !== undefined) queryParams.limit = params.limit.toString();
        if (params?.filter) queryParams.filter = JSON.stringify(params.filter);

        const response = await this.request<IContextResponse>({
            method: Method.Get,
            path: rp(`/rooms/${encodeURIComponent(roomId)}/context/${encodeURIComponent(eventId)}`),
            queryParams: Object.keys(queryParams).length > 0 ? queryParams : undefined,
            prefix: ClientPrefix.V3,
        });

        return response;
    }

    public async redactEvent(
        roomId: string,
        eventId: string,
        reason?: string,
        txnId?: string,
    ): Promise<ISendEventResponse> {
        validateRoomId(roomId);
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }

        const txn = txnId || `m${Date.now()}`;
        const response = await this.withRetry(async () => {
            return await this.request<ISendEventResponse>({
                method: Method.Put,
                path: rp(
                    `/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(eventId)}/${encodeURIComponent(txn)}`,
                ),
                body: reason ? { reason } : {},
                prefix: ClientPrefix.V3,
            });
        });

        return response;
    }

    public async getRoomUnreadCount(roomId: string): Promise<{ notification_count: number; highlight_count: number }> {
        validateRoomId(roomId);

        const response = await this.withRetry(async () => {
            return await this.request<{ notification_count: number; highlight_count: number }>({
                method: Method.Get,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/unread_count`),
                prefix: ClientPrefix.V3,
            });
        });

        return response;
    }

    /**
     * 获取房间通话会话信息（synapse-rust voip_tracking 端点）。
     * GET /_matrix/client/v3/rooms/{room_id}/call/{call_id}
     */
    public async getRoomCall(roomId: string, callId: string): Promise<Record<string, unknown>> {
        validateRoomId(roomId);

        return await this.withRetry(async () => {
            return await this.request<Record<string, unknown>>({
                method: Method.Get,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/call/${encodeURIComponent(callId)}`),
                prefix: ClientPrefix.V3,
            });
        }, "getRoomCall");
    }

    /**
     * 翻译文本（synapse-rust 私有端点）。
     * POST /_matrix/client/v3/translate
     */
    public async translateText(
        text: string,
        targetLang: string,
        sourceLang?: string,
    ): Promise<{ translated_text: string }> {
        const body: Record<string, unknown> = { text, target_lang: targetLang };
        if (sourceLang) body.source_lang = sourceLang;
        return await this.withRetry(async () => {
            return await this.request<{ translated_text: string }>({
                method: Method.Post,
                path: rp("/translate"),
                body,
                prefix: ClientPrefix.V3,
            });
        }, "translateText");
    }

    /**
     * 获取房间 sticky events（synapse-rust 私有端点）。
     * GET /_matrix/client/v3/rooms/{room_id}/sticky_events
     */
    public async getStickyEvents(roomId: string): Promise<Record<string, unknown>> {
        validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.request<Record<string, unknown>>({
                method: Method.Get,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/sticky_events`),
                prefix: ClientPrefix.V3,
            });
        }, "getStickyEvents");
    }

    /**
     * 设置房间 sticky events（synapse-rust 私有端点）。
     * POST /_matrix/client/v3/rooms/{room_id}/sticky_events
     */
    public async setStickyEvents(roomId: string, events: Record<string, unknown>): Promise<void> {
        validateRoomId(roomId);
        await this.withRetry(async () => {
            await this.request<void>({
                method: Method.Post,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/sticky_events`),
                body: events,
                prefix: ClientPrefix.V3,
            });
        }, "setStickyEvents");
    }

    // ==================== Tags ====================

    public async getRoomTags(roomId: string): Promise<ITagsResponse> {
        validateRoomId(roomId);

        const response = await this.withRetry(async () => {
            return await this.request<ITagsResponse>({
                method: Method.Get,
                path: rp(
                    utils.encodeUri("/user/$userId/rooms/$roomId/tags", {
                        $userId: this.client.getUserId()!,
                        $roomId: roomId,
                    }),
                ),
                prefix: ClientPrefix.V3,
            });
        });

        return response;
    }

    public async setRoomTag(roomId: string, tagName: string, metadata: ITagMetadata = {}): Promise<EmptyObject> {
        validateRoomId(roomId);
        if (!tagName) {
            throw new InvalidParamError("tagName is required");
        }

        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Put,
                path: rp(
                    utils.encodeUri("/user/$userId/rooms/$roomId/tags/$tag", {
                        $userId: this.client.getUserId()!,
                        $roomId: roomId,
                        $tag: tagName,
                    }),
                ),
                body: metadata,
                prefix: ClientPrefix.V3,
            });
        });

        return response;
    }

    public async deleteRoomTag(roomId: string, tagName: string): Promise<EmptyObject> {
        validateRoomId(roomId);
        if (!tagName) {
            throw new InvalidParamError("tagName is required");
        }

        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Delete,
                path: rp(
                    utils.encodeUri("/user/$userId/rooms/$roomId/tags/$tag", {
                        $userId: this.client.getUserId()!,
                        $roomId: roomId,
                        $tag: tagName,
                    }),
                ),
                prefix: ClientPrefix.V3,
            });
        });

        return response;
    }

    // ==================== Account Data ====================

    public async setRoomAccountData<K extends keyof RoomAccountDataEvents>(
        roomId: string,
        eventType: K,
        content: RoomAccountDataEvents[K] | Record<string, never>,
    ): Promise<EmptyObject> {
        validateRoomId(roomId);
        if (!eventType) {
            throw new InvalidParamError("eventType is required");
        }

        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Put,
                path: utils.encodeUri("/rooms/$roomId/account_data/$type", { $roomId: roomId, $type: eventType }),
                body: content,
                prefix: ClientPrefix.V3,
            });
        });

        return response;
    }

    // ==================== Room Directory ====================
    //
    // 契约注记（供对账用）：后端同时注册了历史路径 `GET|PUT /rooms/{room_id}/visibility`，
    // 那是 Matrix 早期版本中被本方法取代的**旧路径**，二者是同一能力，故 SDK 只实现规范路径
    // `/directory/list/room/{roomId}`，**不**为旧路径另开方法（见
    // `artifacts/sdk-encapsulation-completion-plan-2026-10-06.md` §3.1）。

    public async getRoomDirectoryVisibility(roomId: string): Promise<{ visibility: Visibility }> {
        validateRoomId(roomId);
        const response = await this.withRetry(async () => {
            return await this.request<{ visibility: Visibility }>({
                method: Method.Get,
                path: utils.encodeUri("/directory/list/room/$roomId", { $roomId: roomId }),
                prefix: ClientPrefix.V3,
            });
        });
        return response;
    }

    public async setRoomDirectoryVisibility(roomId: string, visibility: Visibility): Promise<EmptyObject> {
        validateRoomId(roomId);
        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Put,
                path: utils.encodeUri("/directory/list/room/$roomId", { $roomId: roomId }),
                body: { visibility },
                prefix: ClientPrefix.V3,
            });
        });
        return response;
    }

    // ==================== 用户维度的房间查询 ====================

    /**
     * 列出指定用户已加入的房间 ID。
     *
     * 对应 `GET /_matrix/client/v3/user/{user_id}/rooms`。
     *
     * 后端只允许查询**自己**：`user_id` 与 token 所属用户不一致时返回 403 `Access denied`。
     *
     * @param userId - 目标用户 MXID（必须是当前登录用户）
     * @returns 已加入的房间 ID 列表（`joined_rooms`）
     */
    public async getUserRooms(userId: string): Promise<IUserRoomsResponse> {
        if (!userId) throw new InvalidParamError("userId is required");

        return this.withRetry(async () => {
            return await this.request<IUserRoomsResponse>({
                method: Method.Get,
                path: rp(`/user/${encodeURIComponent(userId)}/rooms`),
                prefix: ClientPrefix.V3,
            });
        }, "getUserRooms");
    }

    /**
     * 查询与目标用户的**共同房间**（MSC2666 **v1 稳定版**）。
     *
     * 对应 `GET /_matrix/client/v1/user/mutual_rooms?user_id=...`。
     *
     * 与 `client.getCapabilities()...ServerCapabilities._unstable_getSharedRooms` 的关系：
     * 后者走 unstable 前缀（`/uk.half-shot.msc2666/...`）并做特性探测；本方法是**稳定版入口**，
     * 直接在 v1 租约上分页，适合后端已确定支持该能力的场景。二者返回结构一致。
     *
     * 注意：查询自己会得到 403。
     *
     * @param userId - 目标用户 MXID
     * @param opts - 分页选项
     * @param opts.limit - 单页上限
     * @param opts.batchToken - 上一页返回的 `next_batch_token`
     * @returns 共同房间列表与下一页 token
     */
    public async getMutualRooms(
        userId: string,
        opts?: { limit?: number; batchToken?: string },
    ): Promise<IMutualRoomsResponse> {
        if (!userId) throw new InvalidParamError("userId is required");

        const queryParams: QueryDict = { user_id: userId };
        if (opts?.limit !== undefined) queryParams.limit = String(opts.limit);
        if (opts?.batchToken) queryParams.batch_token = opts.batchToken;

        return this.withRetry(async () => {
            return await this.request<IMutualRoomsResponse>({
                method: Method.Get,
                path: rp("/user/mutual_rooms"),
                queryParams,
                prefix: ClientPrefix.V1,
            });
        }, "getMutualRooms");
    }

    public async getRoomHierarchy(
        roomId: string,
        limit?: number,
        maxDepth?: number,
        suggestedOnly = false,
        fromToken?: string,
    ): Promise<IRoomHierarchy> {
        validateRoomId(roomId);
        const path = utils.encodeUri("/rooms/$roomId/hierarchy", { $roomId: roomId });
        const query: QueryDict = {
            suggested_only: String(suggestedOnly),
            max_depth: maxDepth?.toString(),
            from: fromToken,
            limit: limit?.toString(),
        };

        try {
            return await this.request<IRoomHierarchy>({
                method: Method.Get,
                path: path,
                queryParams: query as Record<string, string | string[]>,
                prefix: ClientPrefix.V1,
            });
        } catch (e) {
            if ((e as MatrixError).errcode === "M_UNRECOGNIZED") {
                return await this.request<IRoomHierarchy>({
                    method: Method.Get,
                    path: path,
                    queryParams: query as Record<string, string | string[]>,
                    prefix: "/_matrix/client/unstable/org.matrix.msc2946",
                });
            }
            throw e;
        }
    }

    public async getRoomIdForAlias(roomAlias: string): Promise<{ room_id: string; servers: string[] }> {
        if (!roomAlias) throw new InvalidParamError("roomAlias is required");
        const response = await this.withRetry(async () => {
            return await this.request<{ room_id: string; servers: string[] }>({
                method: Method.Get,
                path: utils.encodeUri("/directory/room/$roomAlias", { $roomAlias: roomAlias }),
                prefix: ClientPrefix.V3,
            });
        });
        return response;
    }

    public async createAlias(roomAlias: string, roomId: string): Promise<EmptyObject> {
        if (!roomAlias) throw new InvalidParamError("roomAlias is required");
        validateRoomId(roomId);
        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Put,
                path: utils.encodeUri("/directory/room/$roomAlias", { $roomAlias: roomAlias }),
                body: { room_id: roomId },
                prefix: ClientPrefix.V3,
            });
        });
        return response;
    }

    public async deleteAlias(roomAlias: string): Promise<EmptyObject> {
        if (!roomAlias) throw new InvalidParamError("roomAlias is required");
        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Delete,
                path: utils.encodeUri("/directory/room/$roomAlias", { $roomAlias: roomAlias }),
                prefix: ClientPrefix.V3,
            });
        });
        return response;
    }

    public async getLocalAliases(roomId: string): Promise<{ aliases: string[] }> {
        validateRoomId(roomId);
        const response = await this.withRetry(async () => {
            return await this.request<{ aliases: string[] }>({
                method: Method.Get,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/aliases`),
                prefix: ClientPrefix.V3,
            });
        });
        return response;
    }

    // ==================== Room Management ====================

    public async upgradeRoom(
        roomId: string,
        newVersion: string,
        additionalCreators?: string[],
    ): Promise<{ replacement_room: string }> {
        validateRoomId(roomId);
        const body: { new_version: string; additional_creators?: string[] } = {
            new_version: newVersion,
        };
        if (additionalCreators) {
            body.additional_creators = additionalCreators;
        }

        const response = await this.withRetry(async () => {
            return await this.request<{ replacement_room: string }>({
                method: Method.Post,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/upgrade`),
                body: body,
                prefix: ClientPrefix.V3,
            });
        });
        return response;
    }

    public async reportRoom(roomId: string, reason: string): Promise<EmptyObject> {
        validateRoomId(roomId);
        const response = await this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Post,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/report`),
                body: { reason },
                prefix: ClientPrefix.V3,
            });
        });
        return response;
    }

    public async roomInitialSync(roomId: string): Promise<IRoomInitialSyncResponse> {
        validateRoomId(roomId);
        const response = await this.withRetry(async () => {
            return await this.request<IRoomInitialSyncResponse>({
                method: Method.Get,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/initialSync`),
                prefix: ClientPrefix.V3,
            });
        });
        return response;
    }

    public async setGuestAccess(roomId: string, opts: IGuestAccessOpts): Promise<void> {
        validateRoomId(roomId);
        const writePromise = this.client.sendStateEvent(
            roomId,
            EventType.RoomGuestAccess,
            {
                guest_access: opts.allowJoin ? GuestAccess.CanJoin : GuestAccess.Forbidden,
            },
            "",
        );
        let readPromise: Promise<unknown> = Promise.resolve();
        if (opts.allowRead) {
            readPromise = this.client.sendStateEvent(
                roomId,
                EventType.RoomHistoryVisibility,
                {
                    history_visibility: HistoryVisibility.WorldReadable,
                },
                "",
            );
        }
        await Promise.all([readPromise, writePromise]);
    }

    // ==================== Peeking ====================

    public async peekInRoom(roomId: string, limit = 20): Promise<Room> {
        validateRoomId(roomId);
        const { nextPeekSync, peekPromise } = beginRoomPeek(
            roomId,
            limit,
            this.peekSync,
            () => new SyncApi(this.client, this.client.getClientOpts(), this.client.getSyncApiOptions()),
        );
        this.peekSync = nextPeekSync;
        return peekPromise;
    }

    public stopPeeking(): void {
        this.peekSync = endRoomPeek(this.peekSync);
    }

    // ==================== Typing ====================

    public async getRoomTyping(roomId: string): Promise<string[]> {
        validateRoomId(roomId);
        const path = `/rooms/${encodeURIComponent(roomId)}/typing`;
        const response = await this.request<{ user_ids: string[] }>({
            method: Method.Get,
            path: path,
            prefix: ClientPrefix.V3,
        });
        return response.user_ids || [];
    }

    public async getBatchTyping(roomIds: string[]): Promise<Record<string, string[]>> {
        const path = "/rooms/typing";
        const response = await this.request<{
            rooms: Record<string, { user_ids: string[] }>;
        }>({ method: Method.Post, path: path, body: { room_ids: roomIds }, prefix: ClientPrefix.V3 });

        const result: Record<string, string[]> = {};
        for (const [roomId, data] of Object.entries(response.rooms || {})) {
            result[roomId] = data.user_ids || [];
        }
        return result;
    }

    // ==================== URL Preview ====================

    public async getUrlPreview(url: string, ts: number): Promise<IPreviewUrlResponse> {
        const bucketedTs = Math.floor(ts / 60000) * 60000;

        const parsed = new URL(url);
        parsed.hash = "";
        const normalizedUrl = parsed.toString();
        const key = bucketedTs + "_" + normalizedUrl;

        return this.urlPreviewRequestCache.getOrCreate(key, () =>
            this.request<IPreviewUrlResponse>({
                method: Method.Get,
                path: "/preview_url",
                queryParams: { url: normalizedUrl, ts: bucketedTs.toString() },
                prefix: MediaPrefix.V3,
            }),
        );
    }

    // ==================== Cache Management ====================

    public clearRoomCache(roomId: string): void {
        this.roomInfoCache.delete(`version:${roomId}`);
        this.roomInfoCache.delete(`capabilities:${roomId}`);
        this.roomInfoCache.delete(`metadata:${roomId}`);
        this.roomInfoCache.delete(`joined_members:${roomId}`);
        this.membersCache.delete(`members:${roomId}`);
        this.stateCache.delete(`state:${roomId}`);
    }

    public clearAllCaches(): void {
        this.roomInfoCache.clear();
        this.membersCache.clear();
        this.stateCache.clear();
    }

    // ==================== Synapse-rust specific methods ====================

    /**
     * Get all rooms for the current user, including join, invite, and leave status.
     * Custom endpoint for synapse-rust.
     * GET /_matrix/vendor/v1/my_rooms
     */
    public async getMyRooms(): Promise<IMyRoomsResponse> {
        const response = await this.request<IMyRoomsResponse>({
            method: Method.Get,
            path: "/my_rooms",
            prefix: VendorPrefix,
        });
        return {
            ...response,
            rooms: response.rooms.map((room: IMyRoom) => {
                const membership = room.membership ?? room.join_state;
                const joinState = room.join_state ?? room.membership;
                if (membership === room.membership && joinState === room.join_state) {
                    return room;
                }
                return { ...room, membership, join_state: joinState };
            }),
        };
    }

    /**
     * Search rooms by term (synapse-rust specific).
     * POST /_matrix/vendor/v1/search_rooms
     */
    public async searchRooms(
        searchTerm: string,
        limit?: number,
    ): Promise<{ results: unknown[]; count: number; next_batch: string | null }> {
        return searchRoomsRequest(
            <T>(
                method: Method,
                path: string,
                queryParams?: QueryDict,
                body?: Body,
                requestOpts?: IRequestOpts,
            ): Promise<T> =>
                this.request<T>({
                    method,
                    path,
                    queryParams: queryParams as Record<string, string | string[]>,
                    body,
                    prefix: requestOpts?.prefix ?? VendorPrefix,
                }),
            searchTerm,
            limit,
        );
    }

    /**
     * Get client-facing server config (synapse-rust specific).
     * GET /_matrix/client/v1/config/client
     */
    public async getClientConfig(): Promise<{
        homeserver: { base_url: string; server_name: string };
        identity_server: { base_url: string };
        push: { enabled: boolean };
        email: { enabled: boolean };
        features: Record<string, boolean>;
        defaults: Record<string, unknown>; // Dynamic: server-defined default configuration values
    }> {
        return this.request({ method: Method.Get, path: "/config/client", prefix: ClientPrefix.V1 });
    }

    /**
     * Get SSO/OIDC userinfo (synapse-rust specific).
     * GET /_matrix/client/v3/login/sso/userinfo
     */
    public async getSSOUserInfo(): Promise<{
        sub: string;
        name?: string;
        picture?: string;
        email?: string;
    }> {
        return this.request({
            method: Method.Get,
            path: "/login/sso/userinfo",
            prefix: ClientPrefix.V3,
        });
    }

    /**
     * Check whether the homeserver advertises the synapse-rust sliding-sync surface.
     *
     * Falls back to true for clients that do not expose centralized feature discovery
     * so existing proxy-based sliding-sync deployments keep working.
     */
    public async isSlidingSyncSupported(): Promise<boolean> {
        return doesClientAdvertiseSynapseRustFeature(this.client, SynapseRustFeature.SlidingSync, true);
    }

    /**
     * Perform a single MSC3575 sliding sync request.
     * @param req - The request to make.
     * @param _proxyBaseUrl - The base URL for the sliding sync proxy.
     * @param _abortSignal - Optional signal to abort request mid-flight.
     * @returns The sliding sync response.
     */
    public async slidingSync(
        req: MSC3575SlidingSyncRequest,
        _proxyBaseUrl?: string,
        _abortSignal?: AbortSignal,
    ): Promise<MSC3575SlidingSyncResponse> {
        const qps: Record<string, string | string[] | number> = {};
        if (req.pos !== undefined) {
            qps.pos = req.pos;
        }
        if (req.timeout !== undefined) {
            qps.timeout = req.timeout;
        }
        const { pos: _pos, timeout: _timeout, clientTimeout, ...body } = req;
        return this.request({
            method: Method.Post,
            path: rp("/sync"),
            queryParams: qps,
            body: body,
            prefix: "/_matrix/client/unstable/org.matrix.simplified_msc3575",
            localTimeoutMs: clientTimeout,
            abortSignal: _abortSignal,
        });
    }
}
