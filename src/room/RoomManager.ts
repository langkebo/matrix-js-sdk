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
import type {
    PathAssert,
    StripMsc4354,
    StripR0,
    StripSimplifiedSlidingSync,
    StripV1,
    StripV3,
    StripVendor,
} from "../http-api/strip-prefix";

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
    | StripSimplifiedSlidingSync<SlidingSyncPath>
    | StripVendor<RoomPath>;

function rp<const P extends string>(path: P & PathAssert<P, RoomManagerPath>): P {
    return path;
}

/** MSC4354（sticky events）的 unstable 前缀。 */
const MSC4354_PREFIX = "/_matrix/client/unstable/org.matrix.msc4354";

/**
 * MSC4354（sticky events）unstable 前缀下的路径断言。
 *
 * 为什么不复用 `rp`：`rp` 断言的是 `RoomManagerPath`（client v3/v1/r0 与 simplified
 * sliding sync）。而 sticky events 已归位 `/_matrix/client/unstable/org.matrix.msc4354`
 * （后端 `5a8e44534`）—— 契约表是**只增不减**的并集（codegen 的既有条目 ∪ ledger），
 * 旧 v3 条目仍在表里，因此 `rp` 会**静默通过**一个后端已不再注册的路径。
 * 这个助手把断言锁到 msc4354 空间，避免"路径正确"变成假绿。
 */
function r4354<const P extends string>(path: P & PathAssert<P, StripMsc4354<RoomPath>>): P {
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

    /**
     * 获取本地 store 中已缓存的房间对象。
     *
     * 注意：这是**纯本地**查询，不会发起网络请求；房间不在 store 中时返回 `null`。
     *
     * @param roomId - 房间 ID
     * @returns 匹配的房间对象，未找到时为 `null`
     * @example
     * ```typescript
     * const room = client.getRoomManager().getRoom("!room:example.com");
     * if (room) {
     *     console.log(room.getMyMembership());
     * }
     * ```
     */
    public getRoom(roomId: string | undefined): Room | null {
        return this.client.store.getRoom(roomId!);
    }

    /**
     * 列出本地 store 中缓存的**全部**房间（含已离开的房间）。
     *
     * 纯本地操作，不发起网络请求。
     *
     * @returns 本地已知的房间数组
     * @example
     * ```typescript
     * const rooms = client.getRoomManager().getRooms();
     * console.log(rooms.length, "rooms known locally");
     * ```
     */
    public getRooms(): Room[] {
        return this.client.store.getRooms();
    }

    /**
     * 列出本地 store 中**对当前用户可见**的房间，即成员状态为 `join` 或 `invite` 的房间。
     *
     * 与 {@link getRooms} 的区别：已离开/被封禁的房间会被过滤掉。
     *
     * @returns 可见的房间数组
     * @example
     * ```typescript
     * const visible = client.getRoomManager().getVisibleRooms();
     * console.log(visible.length, "visible rooms");
     * ```
     */
    public getVisibleRooms(_msc3946ProcessDynamicPredecessor = false): Room[] {
        // Implementation moved from MatrixClient
        const rooms = this.client.store.getRooms();
        return rooms.filter((room) => {
            const myMembership = room.getMyMembership();
            return myMembership === KnownMembership.Join || myMembership === KnownMembership.Invite;
        });
    }

    /**
     * 获取房间的 room version（synapse-rust 私有端点）。
     *
     * 对应 `GET /_matrix/vendor/v1/rooms/{roomId}/version`；结果按房间缓存，
     * `forceRefresh` 可绕过缓存。
     *
     * @param roomId - 房间 ID
     * @param forceRefresh - 为 `true` 时跳过缓存重新拉取，默认 `false`
     * @returns room version 字符串（如 `"10"`）
     * @throws ValidationError `roomId` 格式非法时
     * @example
     * ```typescript
     * const version = await client.getRoomManager().getRoomVersion("!room:example.com");
     * console.log("room version:", version);
     * ```
     */
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
                prefix: VendorPrefix,
            });
        });

        this.roomInfoCache.set(cacheKey, { room_version: response.room_version });
        return response.room_version;
    }

    /**
     * 获取房间的能力（capabilities）（synapse-rust 私有端点）。
     *
     * 对应 `GET /_matrix/vendor/v1/rooms/{roomId}/capabilities`；结果按房间缓存，
     * `forceRefresh` 可绕过缓存。
     *
     * @param roomId - 房间 ID
     * @param forceRefresh - 为 `true` 时跳过缓存重新拉取，默认 `false`
     * @returns 含 `capabilities` 映射的响应
     * @throws ValidationError `roomId` 格式非法时
     * @example
     * ```typescript
     * const capabilities = await client.getRoomManager().getRoomCapabilities("!room:example.com");
     * ```
     */
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
                prefix: VendorPrefix,
            });
        });

        this.roomInfoCache.set(cacheKey, response);
        return response;
    }

    /**
     * 获取房间的元数据（synapse-rust 私有端点）。
     *
     * 对应 `GET /_matrix/vendor/v1/rooms/{roomId}/metadata`；结果按房间缓存，
     * `forceRefresh` 可绕过缓存。
     *
     * @param roomId - 房间 ID
     * @param forceRefresh - 为 `true` 时跳过缓存重新拉取，默认 `false`
     * @returns 房间元数据（`room_id`、`name`、`topic` 等）
     * @throws ValidationError `roomId` 格式非法时
     * @example
     * ```typescript
     * const metadata = await client.getRoomManager().getRoomMetadata("!room:example.com");
     * console.log(metadata.name);
     * ```
     */
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
                prefix: VendorPrefix,
            });
        });

        this.roomInfoCache.set(cacheKey, response);
        return response;
    }

    // ==================== Room Lifecycle ====================

    /**
     * 创建新房间。
     *
     * 对应 `POST /_matrix/client/v3/createRoom`。若 `options.invite_3pid` 中的条目缺少
     * `id_access_token` 且已配置 identity server，会自动补齐。创建成功后触发
     * {@link RoomEvent.RoomCreated}。
     *
     * @param options - 建房选项（`preset`、`name`、`topic`、`invite`、`initial_state` 等）
     * @returns 含新房间 `room_id` 的对象
     * @example
     * ```typescript
     * const { room_id } = await client.getRoomManager().createRoom({
     *     name: "我的房间",
     *     preset: "private_chat",
     * });
     * ```
     */
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
     * @example
     * ```typescript
     * const { room_id } = await client.getRoomManager().createPrivateRoom({
     *     invite: ["@peer:example.com"],
     *     name: "私聊",
     * });
     * ```
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

    /**
     * 加入房间（接受房间 ID 或别名）。
     *
     * 对应 `POST /_matrix/client/v3/join/{roomIdOrAlias}`。若当前用户已是 `join` 状态，
     * 直接返回本地房间对象；否则发起加入请求，并在需要时处理第三方签名与共享历史密钥分发。
     *
     * @param roomIdOrAlias - 房间 ID 或别名
     * @param opts - 加入选项（`viaServers`、`inviteSignUrl`、`acceptSharedHistory` 等）
     * @returns 加入后的房间对象
     * @example
     * ```typescript
     * const room = await client.getRoomManager().joinRoom("!room:example.com");
     * ```
     */
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

    /**
     * 申请加入房间（knock）。
     *
     * 对应 `POST /_matrix/client/v3/knock/{roomIdOrAlias}`。若当前用户已处于 `knock`
     * 状态，直接返回本地房间 ID。
     *
     * @param roomIdOrAlias - 房间 ID 或别名
     * @param opts - 选项（`viaServers`、`reason`）
     * @returns 含目标房间 `room_id` 的对象
     * @example
     * ```typescript
     * const { room_id } = await client.getRoomManager().knockRoom("!room:example.com", { reason: "想加入" });
     * ```
     */
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
     * @example
     * ```typescript
     * await client.getRoomManager().leave("!room:example.com");
     * ```
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

    /**
     * 忘记一个已离开的房间。
     *
     * 对应 `POST /_matrix/client/v3/rooms/{roomId}/forget`。当 `deleteRoom` 为 `true` 时，
     * 会同时从本地 store 移除该房间并触发 {@link ClientEvent.DeleteRoom}。
     *
     * @param roomId - 房间 ID
     * @param deleteRoom - 是否同时从本地 store 删除该房间，默认 `true`
     * @returns 空对象
     * @throws ValidationError `roomId` 格式非法时
     * @example
     * ```typescript
     * await client.getRoomManager().forget("!room:example.com");
     * ```
     */
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

    /**
     * 获取房间成员事件列表。
     *
     * 对应 `GET /_matrix/client/v3/rooms/{roomId}/members`。未传 `params` 时结果会被缓存；
     * 传了过滤参数或 `forceRefresh` 为 `true` 则跳过缓存。
     *
     * @param roomId - 房间 ID
     * @param params - 过滤条件（`membership`、`not_membership`、`at`）
     * @param forceRefresh - 为 `true` 时强制刷新，默认 `false`
     * @returns 成员状态事件数组
     * @throws ValidationError `roomId` 格式非法时
     * @example
     * ```typescript
     * const members = await client.getRoomManager().getMembers("!room:example.com", { membership: "join" });
     * ```
     */
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

    /**
     * 获取房间中已加入成员的概要信息。
     *
     * 对应 `GET /_matrix/client/v3/rooms/{roomId}/joined_members`；结果会被缓存。
     *
     * @param roomId - 房间 ID
     * @param forceRefresh - 为 `true` 时强制刷新，默认 `false`
     * @returns 以用户 ID 为键、含 `display_name`/`avatar_url` 的映射
     * @throws ValidationError `roomId` 格式非法时
     * @example
     * ```typescript
     * const { joined } = await client.getRoomManager().getJoinedMembers("!room:example.com");
     * console.log(Object.keys(joined).length, "joined members");
     * ```
     */
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
     * @throws 请求失败时抛出原始错误；当 `throwOnError` 为 `false` 时仅将 404 视为 `null`，其它错误仍会抛出
     * @example
     * ```typescript
     * const membership = await client.getRoomManager().getMembership("!room:example.com", "@peer:example.com");
     * ```
     */
    public async getMembership(roomId: string, userId: string, throwOnError = true): Promise<IStateEvent | null> {
        validateRoomId(roomId);
        validateUserId(userId);

        try {
            const response = await this.withRetry(async () => {
                return await this.request<IStateEvent>({
                    method: Method.Get,
                    path: rp(`/rooms/${encodeURIComponent(roomId)}/membership/${encodeURIComponent(userId)}`),
                    prefix: VendorPrefix,
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

    /**
     * 邀请用户加入房间。
     *
     * 对应 `POST /_matrix/client/v3/rooms/{roomId}/invite`。当 `opts.shareEncryptedHistory`
     * 为 `true` 时，会先尝试与目标用户共享加密历史；成功后清除成员缓存并触发
     * {@link RoomEvent.MemberJoined}。
     *
     * @param roomId - 房间 ID
     * @param userId - 被邀请用户的 MXID
     * @param opts - 选项对象，或直接传字符串作为 `reason`
     * @returns 空对象
     * @throws InvalidParamError / ValidationError `userId` 格式非法时
     * @example
     * ```typescript
     * await client.getRoomManager().invite("!room:example.com", "@peer:example.com", { reason: "欢迎" });
     * ```
     */
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

    /**
     * 通过邮箱地址邀请用户加入房间。
     *
     * 是 {@link inviteByThreePid} 以 `"email"` 为 medium 的便捷封装。
     *
     * @param roomId - 房间 ID
     * @param email - 被邀请者的邮箱地址
     * @returns 空对象
     * @example
     * ```typescript
     * await client.getRoomManager().inviteByEmail("!room:example.com", "peer@example.com");
     * ```
     */
    public async inviteByEmail(roomId: string, email: string): Promise<EmptyObject> {
        return this.inviteByThreePid(roomId, "email", email);
    }

    /**
     * 通过第三方标识（3PID）邀请用户加入房间。
     *
     * 对应 `POST /_matrix/client/v3/rooms/{roomId}/invite`，使用 identity server 解析
     * `medium` + `address`。
     *
     * @param roomId - 房间 ID
     * @param medium - 3PID 类型（如 `"email"`、`"msisdn"`）
     * @param address - 对应的地址
     * @returns 空对象
     * @throws ValidationError `roomId` 格式非法时
     * @example
     * ```typescript
     * await client.getRoomManager().inviteByThreePid("!room:example.com", "email", "peer@example.com");
     * ```
     */
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

    /**
     * 将用户踢出房间。
     *
     * 对应 `POST /_matrix/client/v3/rooms/{roomId}/kick`；成功后清除成员缓存并触发
     * {@link RoomEvent.MemberLeft}。
     *
     * @param roomId - 房间 ID
     * @param userId - 被踢用户的 MXID
     * @param reason - 可选原因
     * @returns 空对象
     * @throws InvalidParamError / ValidationError `userId` 格式非法时
     * @example
     * ```typescript
     * await client.getRoomManager().kick("!room:example.com", "@peer:example.com", "违反规则");
     * ```
     */
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

    /**
     * 封禁用户，禁止其进入房间。
     *
     * 对应 `POST /_matrix/client/v3/rooms/{roomId}/ban`；成功后清除成员缓存。
     *
     * @param roomId - 房间 ID
     * @param userId - 被封禁用户的 MXID
     * @param reason - 可选原因
     * @returns 空对象
     * @throws InvalidParamError / ValidationError `userId` 格式非法时
     * @example
     * ```typescript
     * await client.getRoomManager().ban("!room:example.com", "@spammer:example.com", "刷屏");
     * ```
     */
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

    /**
     * 解除对用户的封禁。
     *
     * 对应 `POST /_matrix/client/v3/rooms/{roomId}/unban`；成功后清除成员缓存。
     *
     * @param roomId - 房间 ID
     * @param userId - 被解封用户的 MXID
     * @returns 空对象
     * @throws InvalidParamError / ValidationError `userId` 格式非法时
     * @example
     * ```typescript
     * await client.getRoomManager().unban("!room:example.com", "@peer:example.com");
     * ```
     */
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

    /**
     * 获取房间当前的状态事件列表。
     *
     * 委托给 EventManager（`client.getEventManager().getState`）。
     *
     * @param roomId - 房间 ID
     * @param forceRefresh - 为 `true` 时强制刷新，默认 `false`
     * @returns 状态事件数组
     * @example
     * ```typescript
     * const state = await client.getRoomManager().getState("!room:example.com");
     * ```
     */
    public async getState(roomId: string, forceRefresh = false): Promise<IStateEvent[]> {
        return this.client.getEventManager().getState(roomId, forceRefresh);
    }

    /**
     * 获取指定类型的房间状态事件内容。
     *
     * 委托给 EventManager（`client.getEventManager().getStateEvent`）。
     *
     * @param roomId - 房间 ID
     * @param eventType - 状态事件类型（如 `m.room.name`）
     * @param stateKey - 状态键，默认为空字符串
     * @returns 该状态事件的 content 内容
     * @example
     * ```typescript
     * const name = await client.getRoomManager().getStateEvent("!room:example.com", "m.room.name");
     * ```
     */
    public async getStateEvent(roomId: string, eventType: string, stateKey = ""): Promise<IContent> {
        return this.client.getEventManager().getStateEvent(roomId, eventType, stateKey);
    }

    /**
     * 发送房间状态事件。
     *
     * 委托给 EventManager（`client.getEventManager().sendStateEvent`）。
     *
     * @param roomId - 房间 ID
     * @param eventType - 状态事件类型
     * @param content - 事件内容
     * @param stateKey - 状态键，默认为空字符串
     * @returns 含 `event_id` 的发送结果
     * @example
     * ```typescript
     * await client.getRoomManager().sendStateEvent("!room:example.com", "m.room.topic", { topic: "hi" });
     * ```
     */
    public async sendStateEvent(
        roomId: string,
        eventType: string,
        content: IContent,
        stateKey = "",
    ): Promise<ISendEventResponse> {
        return this.client.getEventManager().sendStateEvent(roomId, eventType, content, stateKey);
    }

    /**
     * 设置房间名称（`m.room.name` 状态事件）。
     *
     * @param roomId - 房间 ID
     * @param name - 新的房间名称
     * @returns 含 `event_id` 的发送结果
     * @example
     * ```typescript
     * await client.getRoomManager().setRoomName("!room:example.com", "新名称");
     * ```
     */
    public setRoomName(roomId: string, name: string): Promise<ISendEventResponse> {
        return this.client.sendStateEvent(roomId, "m.room.name", { name }, "");
    }

    /**
     * 设置房间主题（`m.room.topic` 状态事件）。
     *
     * @param roomId - 房间 ID
     * @param topic - 纯文本主题
     * @param htmlTopic - 可选 HTML 主题
     * @returns 含 `event_id` 的发送结果
     * @example
     * ```typescript
     * await client.getRoomManager().setRoomTopic("!room:example.com", "公告栏");
     * ```
     */
    public setRoomTopic(roomId: string, topic?: string, htmlTopic?: string): Promise<ISendEventResponse> {
        const content = ContentHelpers.makeTopicContent(topic, htmlTopic);
        return this.client.sendStateEvent(roomId, EventType.RoomTopic, content, undefined);
    }

    // ==================== Events ====================

    /**
     * 按事件 ID 获取房间中的单个事件。
     *
     * 对应 `GET /_matrix/client/v3/rooms/{roomId}/event/{eventId}`。
     *
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     * @returns 事件对象
     * @throws ValidationError `roomId` 格式非法时；`InvalidParamError` 当 `eventId` 为空时
     * @example
     * ```typescript
     * const event = await client.getRoomManager().getEvent("!room:example.com", "$event");
     * ```
     */
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

    /**
     * 获取某事件的前后文（上下文）。
     *
     * 对应 `GET /_matrix/client/v3/rooms/{roomId}/context/{eventId}`。
     *
     * @param roomId - 房间 ID
     * @param eventId - 目标事件 ID
     * @param params - 选项：`limit` 单页数量、`filter` 事件过滤
     * @returns 含事件前后文与分页 token 的上下文响应
     * @throws ValidationError `roomId` 格式非法时；`InvalidParamError` 当 `eventId` 为空时
     * @example
     * ```typescript
     * const ctx = await client.getRoomManager().getEventContext("!room:example.com", "$event", { limit: 10 });
     * ```
     */
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

    /**
     * 撤回（redact）房间中的事件。
     *
     * 对应 `PUT /_matrix/client/v3/rooms/{roomId}/redact/{eventId}/{txnId}`；未提供
     * `txnId` 时会自动生成一个事务 ID。
     *
     * @param roomId - 房间 ID
     * @param eventId - 被撤回的事件 ID
     * @param reason - 可选撤回原因
     * @param txnId - 可选事务 ID，缺省自动生成
     * @returns 含新事件 `event_id` 的发送结果
     * @throws ValidationError `roomId` 格式非法时；`InvalidParamError` 当 `eventId` 为空时
     * @example
     * ```typescript
     * await client.getRoomManager().redactEvent("!room:example.com", "$event", "内容不当");
     * ```
     */
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

    /**
     * 获取房间的未读计数（synapse-rust 私有端点）。
     *
     * 对应 `GET /_matrix/vendor/v1/rooms/{roomId}/unread_count`。
     *
     * @param roomId - 房间 ID
     * @returns 含 `notification_count` 与 `highlight_count` 的对象
     * @throws ValidationError `roomId` 格式非法时
     * @example
     * ```typescript
     * const { notification_count } = await client.getRoomManager().getRoomUnreadCount("!room:example.com");
     * ```
     */
    public async getRoomUnreadCount(roomId: string): Promise<{ notification_count: number; highlight_count: number }> {
        validateRoomId(roomId);

        const response = await this.withRetry(async () => {
            return await this.request<{ notification_count: number; highlight_count: number }>({
                method: Method.Get,
                path: rp(`/rooms/${encodeURIComponent(roomId)}/unread_count`),
                prefix: VendorPrefix,
            });
        });

        return response;
    }

    /**
     * 获取房间通话会话信息（synapse-rust voip_tracking 端点）。
     * GET /_matrix/client/v3/rooms/{room_id}/call/{call_id}
     * @example
     * ```typescript
     * const call = await client.getRoomManager().getRoomCall("!room:example.com", "call-1");
     * ```
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
     * @example
     * ```typescript
     * const { translated_text } = await client.getRoomManager().translateText("hello", "zh");
     * ```
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
                prefix: VendorPrefix,
            });
        }, "translateText");
    }

    /**
     * 获取房间 sticky events（synapse-rust 私有端点，MSC4354）。
     * GET /_matrix/client/unstable/org.matrix.msc4354/rooms/{room_id}/sticky_events
     * @example
     * ```typescript
     * const sticky = await client.getRoomManager().getStickyEvents("!room:example.com");
     * ```
     */
    public async getStickyEvents(roomId: string): Promise<Record<string, unknown>> {
        validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.request<Record<string, unknown>>({
                method: Method.Get,
                path: r4354(`/rooms/${encodeURIComponent(roomId)}/sticky_events`),
                prefix: MSC4354_PREFIX,
            });
        }, "getStickyEvents");
    }

    /**
     * 设置房间 sticky events（synapse-rust 私有端点，MSC4354）。
     * POST /_matrix/client/unstable/org.matrix.msc4354/rooms/{room_id}/sticky_events
     * @example
     * ```typescript
     * await client.getRoomManager().setStickyEvents("!room:example.com", { sticky: [] });
     * ```
     */
    public async setStickyEvents(roomId: string, events: Record<string, unknown>): Promise<void> {
        validateRoomId(roomId);
        await this.withRetry(async () => {
            await this.request<void>({
                method: Method.Post,
                path: r4354(`/rooms/${encodeURIComponent(roomId)}/sticky_events`),
                body: events,
                prefix: MSC4354_PREFIX,
            });
        }, "setStickyEvents");
    }

    // ==================== Tags ====================

    /**
     * 获取当前用户在房间上的标签（tags）。
     *
     * 对应 `GET /_matrix/client/v3/user/{userId}/rooms/{roomId}/tags`。
     *
     * @param roomId - 房间 ID
     * @returns 标签映射响应 `ITagsResponse`
     * @throws ValidationError `roomId` 格式非法时
     * @example
     * ```typescript
     * const { tags } = await client.getRoomManager().getRoomTags("!room:example.com");
     * ```
     */
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

    /**
     * 为房间设置/更新标签。
     *
     * 对应 `PUT /_matrix/client/v3/user/{userId}/rooms/{roomId}/tags/{tag}`。
     *
     * @param roomId - 房间 ID
     * @param tagName - 标签名（如 `m.favourite`）
     * @param metadata - 标签元数据，默认 `{}`
     * @returns 空对象
     * @throws ValidationError `roomId` 格式非法时；`InvalidParamError` 当 `tagName` 为空时
     * @example
     * ```typescript
     * await client.getRoomManager().setRoomTag("!room:example.com", "m.favourite", { order: 0.5 });
     * ```
     */
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

    /**
     * 删除房间上的某个标签。
     *
     * 对应 `DELETE /_matrix/client/v3/user/{userId}/rooms/{roomId}/tags/{tag}`。
     *
     * @param roomId - 房间 ID
     * @param tagName - 待删除的标签名
     * @returns 空对象
     * @throws ValidationError `roomId` 格式非法时；`InvalidParamError` 当 `tagName` 为空时
     * @example
     * ```typescript
     * await client.getRoomManager().deleteRoomTag("!room:example.com", "m.favourite");
     * ```
     */
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

    /**
     * 设置房间级账号数据（room account data）。
     *
     * 对应 `PUT /_matrix/client/v3/rooms/{roomId}/account_data/{type}`。
     *
     * @param roomId - 房间 ID
     * @param eventType - 账号数据类型
     * @param content - 数据内容
     * @returns 空对象
     * @throws ValidationError `roomId` 格式非法时；`InvalidParamError` 当 `eventType` 为空时
     * @example
     * ```typescript
     * await client.getRoomManager().setRoomAccountData("!room:example.com", "m.fully_read", { event_id: "$e" });
     * ```
     */
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

    /**
     * 查询房间在目录中的可见性。
     *
     * 对应 `GET /_matrix/client/v3/directory/list/room/{roomId}`。
     *
     * @param roomId - 房间 ID
     * @returns 含 `visibility` 的对象（`public` / `private`）
     * @throws ValidationError `roomId` 格式非法时
     * @example
     * ```typescript
     * const { visibility } = await client.getRoomManager().getRoomDirectoryVisibility("!room:example.com");
     * ```
     */
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

    /**
     * 设置房间在目录中的可见性。
     *
     * 对应 `PUT /_matrix/client/v3/directory/list/room/{roomId}`。
     *
     * @param roomId - 房间 ID
     * @param visibility - 目标可见性（`public` / `private`）
     * @returns 空对象
     * @throws ValidationError `roomId` 格式非法时
     * @example
     * ```typescript
     * await client.getRoomManager().setRoomDirectoryVisibility("!room:example.com", Visibility.Public);
     * ```
     */
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
     * @throws InvalidParamError `userId` 为空时；查询他人时后端返回 403
     * @example
     * ```typescript
     * const { joined_rooms } = await client.getRoomManager().getUserRooms(client.getUserId()!);
     * console.log(joined_rooms.length, "rooms joined");
     * ```
     */
    public async getUserRooms(userId: string): Promise<IUserRoomsResponse> {
        if (!userId) throw new InvalidParamError("userId is required");

        return this.withRetry(async () => {
            return await this.request<IUserRoomsResponse>({
                method: Method.Get,
                path: rp(`/user/${encodeURIComponent(userId)}/rooms`),
                prefix: VendorPrefix,
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
     * @throws InvalidParamError `userId` 为空时；查询自己时后端返回 403
     * @example
     * ```typescript
     * const res = await client.getRoomManager().getMutualRooms("@peer:example.com", { limit: 50 });
     * console.log(res.joined.length, "mutual rooms");
     * ```
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
                prefix: VendorPrefix,
            });
        }, "getMutualRooms");
    }

    /**
     * 获取空间（space）的房间层级结构。
     *
     * 优先使用 v1 稳定路径 `GET /_matrix/client/v1/rooms/{roomId}/hierarchy`；当后端返回
     * `M_UNRECOGNIZED` 时回退到 `/_matrix/client/unstable/org.matrix.msc2946` 前缀重试。
     *
     * @param roomId - 空间/房间 ID
     * @param limit - 单页数量上限
     * @param maxDepth - 最大递归深度
     * @param suggestedOnly - 仅返回被推荐（suggested）的子房间
     * @param fromToken - 分页 token
     * @returns 房间层级结构 `IRoomHierarchy`
     * @throws ValidationError `roomId` 格式非法时；请求失败时抛出底层 `MatrixError`
     * @example
     * ```typescript
     * const hierarchy = await client.getRoomManager().getRoomHierarchy("!space:example.com", 50, 2);
     * ```
     */
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

    /**
     * 根据房间别名解析出房间 ID。
     *
     * 对应 `GET /_matrix/client/v3/directory/room/{roomAlias}`。
     *
     * @param roomAlias - 房间别名（如 `#room:example.com`）
     * @returns 含 `room_id` 与参与服务器列表的对象
     * @throws InvalidParamError `roomAlias` 为空时
     * @example
     * ```typescript
     * const { room_id } = await client.getRoomManager().getRoomIdForAlias("#room:example.com");
     * ```
     */
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

    /**
     * 为房间创建本地别名。
     *
     * 对应 `PUT /_matrix/client/v3/directory/room/{roomAlias}`。
     *
     * @param roomAlias - 待创建的别名
     * @param roomId - 目标房间 ID
     * @returns 空对象
     * @throws InvalidParamError `roomAlias` 为空时；`ValidationError` 当 `roomId` 格式非法时
     * @example
     * ```typescript
     * await client.getRoomManager().createAlias("#myroom:example.com", "!room:example.com");
     * ```
     */
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

    /**
     * 删除房间别名。
     *
     * 对应 `DELETE /_matrix/client/v3/directory/room/{roomAlias}`。
     *
     * @param roomAlias - 待删除的别名
     * @returns 空对象
     * @throws InvalidParamError `roomAlias` 为空时
     * @example
     * ```typescript
     * await client.getRoomManager().deleteAlias("#myroom:example.com");
     * ```
     */
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

    /**
     * 获取房间在本服务器上的本地别名列表。
     *
     * 对应 `GET /_matrix/client/v3/rooms/{roomId}/aliases`。
     *
     * @param roomId - 房间 ID
     * @returns 含 `aliases` 字符串数组的对象
     * @throws ValidationError `roomId` 格式非法时
     * @example
     * ```typescript
     * const { aliases } = await client.getRoomManager().getLocalAliases("!room:example.com");
     * ```
     */
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

    /**
     * 将房间升级到新的 room version。
     *
     * 对应 `POST /_matrix/client/v3/rooms/{roomId}/upgrade`。
     *
     * @param roomId - 待升级的房间 ID
     * @param newVersion - 目标 room version
     * @param additionalCreators - 可选，额外指定拥有升级后房间创建权限的用户
     * @returns 含 `replacement_room`（新房间 ID）的对象
     * @throws ValidationError `roomId` 格式非法时
     * @example
     * ```typescript
     * const { replacement_room } = await client.getRoomManager().upgradeRoom("!room:example.com", "10");
     * ```
     */
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

    /**
     * 举报房间。
     *
     * 对应 `POST /_matrix/client/v3/rooms/{roomId}/report`。
     *
     * @param roomId - 被举报的房间 ID
     * @param reason - 举报原因
     * @returns 空对象
     * @throws ValidationError `roomId` 格式非法时
     * @example
     * ```typescript
     * await client.getRoomManager().reportRoom("!room:example.com", "垃圾信息");
     * ```
     */
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

    /**
     * 对房间执行一次初始同步（initialSync）。
     *
     * 对应 `GET /_matrix/client/v3/rooms/{roomId}/initialSync`，返回该房间的完整初始状态与事件。
     *
     * @param roomId - 房间 ID
     * @returns 房间初始同步响应
     * @throws ValidationError `roomId` 格式非法时
     * @example
     * ```typescript
     * const initial = await client.getRoomManager().roomInitialSync("!room:example.com");
     * ```
     */
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

    /**
     * 配置房间的访客访问权限。
     *
     * 通过发送 `m.room.guest_access` 状态事件实现；当 `opts.allowRead` 为 `true` 时，
     * 额外发送 `m.room.history_visibility = world_readable`。两个请求并发执行。
     *
     * @param roomId - 房间 ID
     * @param opts - 访客访问选项：`allowJoin` 是否允许加入、`allowRead` 是否允许读取历史
     * @throws ValidationError `roomId` 格式非法时
     * @example
     * ```typescript
     * await client.getRoomManager().setGuestAccess("!room:example.com", { allowJoin: true, allowRead: false });
     * ```
     */
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

    /**
     * 窥视（peek）房间，在不加入的情况下获取房间内容。
     *
     * 内部通过一个独立的 SyncApi 建立窥视会话。
     *
     * @param roomId - 房间 ID
     * @param limit - 初始拉取的事件数量上限，默认 `20`
     * @returns 窥视得到的房间对象
     * @throws ValidationError `roomId` 格式非法时
     * @example
     * ```typescript
     * const room = await client.getRoomManager().peekInRoom("!room:example.com", 10);
     * ```
     */
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

    /**
     * 停止当前正在进行的房间窥视（peek）会话。
     *
     * @example
     * ```typescript
     * client.getRoomManager().stopPeeking();
     * ```
     */
    public stopPeeking(): void {
        this.peekSync = endRoomPeek(this.peekSync);
    }

    // ==================== Typing ====================

    /**
     * 获取房间中正在输入的用户列表。
     *
     * 对应 `GET /_matrix/client/v3/rooms/{roomId}/typing`。
     *
     * @param roomId - 房间 ID
     * @returns 正在输入的用户 ID 数组
     * @throws ValidationError `roomId` 格式非法时
     * @example
     * ```typescript
     * const typing = await client.getRoomManager().getRoomTyping("!room:example.com");
     * ```
     */
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

    /**
     * 批量获取多个房间中正在输入的用户列表。
     *
     * 对应 `POST /_matrix/client/v3/rooms/typing`，请求体为 `{ room_ids }`。
     *
     * @param roomIds - 房间 ID 数组
     * @returns 以房间 ID 为键、正在输入用户 ID 数组为值的映射
     * @example
     * ```typescript
     * const typing = await client.getRoomManager().getBatchTyping(["!a:example.com", "!b:example.com"]);
     * ```
     */
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

    /**
     * 获取 URL 的预览信息。
     *
     * 对应媒体端点 `GET /_matrix/media/v3/preview_url`。时间戳按分钟取整作为缓存键，
     * 并对进行中的相同请求做合并去重。
     *
     * @param url - 待预览的 URL
     * @param ts - 客户端当前时间戳（毫秒）
     * @returns URL 预览响应
     * @example
     * ```typescript
     * const preview = await client.getRoomManager().getUrlPreview("https://example.com", Date.now());
     * ```
     */
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

    /**
     * 清除某个房间的所有本地缓存条目（版本、能力、元数据、已加入成员、成员、状态）。
     *
     * @param roomId - 房间 ID
     * @example
     * ```typescript
     * client.getRoomManager().clearRoomCache("!room:example.com");
     * ```
     */
    public clearRoomCache(roomId: string): void {
        this.roomInfoCache.delete(`version:${roomId}`);
        this.roomInfoCache.delete(`capabilities:${roomId}`);
        this.roomInfoCache.delete(`metadata:${roomId}`);
        this.roomInfoCache.delete(`joined_members:${roomId}`);
        this.membersCache.delete(`members:${roomId}`);
        this.stateCache.delete(`state:${roomId}`);
    }

    /**
     * 清空 RoomManager 的全部本地缓存（房间信息、成员、状态）。
     *
     * @example
     * ```typescript
     * client.getRoomManager().clearAllCaches();
     * ```
     */
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
     * @example
     * ```typescript
     * const { rooms, total } = await client.getRoomManager().getMyRooms();
     * ```
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
     * @example
     * ```typescript
     * const res = await client.getRoomManager().searchRooms("project", 20);
     * ```
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
     * @example
     * ```typescript
     * const config = await client.getRoomManager().getClientConfig();
     * ```
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
     * @example
     * ```typescript
     * const info = await client.getRoomManager().getSSOUserInfo();
     * ```
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
     * @example
     * ```typescript
     * const supported = await client.getRoomManager().isSlidingSyncSupported();
     * ```
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
     * @example
     * ```typescript
     * const res = await client.getRoomManager().slidingSync({ timeout: 1000 });
     * ```
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
