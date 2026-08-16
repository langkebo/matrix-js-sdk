/*
Copyright 2015 - 2021 The Matrix.org Foundation C.I.C.

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
 * This is an internal module. See {@link MemoryStore} for the public class.
 */

import { type EventType } from "../@types/event";
import { type Room } from "../models/room";
import { type User } from "../models/user";
import { type IEvent, type MatrixEvent } from "../models/event";
import { type RoomState, RoomStateEvent } from "../models/room-state";
import { type RoomMember } from "../models/room-member";
import { type Filter } from "../filter";
import { type ISavedSync, type IStore, type UserCreator } from "./index";
import { type RoomSummary } from "../models/room-summary";
import { type ISyncResponse } from "../sync-accumulator";
import { logger } from "../logger";
import { type IStateEventWithRoomId } from "../@types/search";
import { type IndexedToDeviceBatch, type ToDeviceBatchWithTxnId } from "../models/ToDeviceMessage";
import { type IStoredClientOpts } from "../client";
import { MapWithDefault } from "../common/collections";
import { KnownMembership } from "../@types/membership";
import { StoreStatsCollector, type StoreStats } from "./stats";
import { DEFAULT_STORE_CAPACITY, LruMap, type StoreCapacityConfig } from "./capacity";
import { defaultOobMembersTtl, type OobMembersTtlProvider } from "./ttl";
import { PendingEventsCipher } from "./pending-events-cipher";

function isValidFilterId(filterId?: string | number | null): boolean {
    const isValidStr =
        typeof filterId === "string" &&
        !!filterId &&
        filterId !== "undefined" && // exclude these as we've serialized undefined in localStorage before
        filterId !== "null";

    return isValidStr || typeof filterId === "number";
}

/**
 * 内存占用估算常量（字节/条）。仅作 advisory 估值，用于对齐后端 `memory_usage_bytes`
 * 指标，不参与淘汰决策。deep 序列化 Room/User（含循环引用与监听器）开销大且不安全，
 * 故采用按条目数 × 经验均值的粗估。
 */
const ESTIMATED_ROOM_BYTES = 50 * 1024; // room 含 timeline，均摊约 50KB
const ESTIMATED_USER_BYTES = 2 * 1024; // user profile 约 2KB
const ESTIMATED_OOB_MEMBER_BYTES = 1 * 1024; // OOB 成员事件数组约 1KB
const ESTIMATED_ACCOUNT_DATA_BYTES = 1 * 1024;
const ESTIMATED_EVENT_BYTES = 1 * 1024; // pending 事件约 1KB
const ESTIMATED_TO_DEVICE_BYTES = 1 * 1024;

export interface IOpts {
    /** The local storage instance to persist some forms of data such as tokens. Rooms will NOT be stored. */
    localStorage?: Storage;
    /**
     * 可选容量预算覆盖项。未提供的字段回落到 {@link DEFAULT_STORE_CAPACITY}。
     */
    capacity?: Partial<StoreCapacityConfig>;
    /**
     * 可选 OOB 成员 TTL 解析器：按 roomId 动态返回 TTL（秒）。
     * 未提供时回落到 {@link defaultOobMembersTtl}（统一 room_members 900s）。
     * 返回 `TTL_PERSISTENT` 持久、`0` 禁用缓存、正数为 TTL 秒。
     */
    oobMembersTtl?: OobMembersTtlProvider;
    /**
     * 可选待发事件加密器（ISSUE-08c）。仅 `IndexedDBStore` 落盘路径使用：
     * 提供时待发事件加密后持久化；未提供时 `IndexedDBStore` 不再明文落盘
     * （退化为仅内存，重启后待发事件不恢复）。
     */
    pendingEventsCipher?: PendingEventsCipher;
}

export class MemoryStore implements IStore {
    private rooms: LruMap<string, Room>; // roomId: Room
    private users: LruMap<string, User>; // userId: User
    private syncToken: string | null = null;
    // userId: {
    //    filterId: Filter
    // }
    private filters: MapWithDefault<string, Map<string, Filter>> = new MapWithDefault(() => new Map());
    public accountData: Map<string, MatrixEvent> = new Map(); // type: content
    protected readonly localStorage?: Storage;
    private oobMembers: LruMap<string, IStateEventWithRoomId[]>; // roomId: [member events]
    private pendingEvents: { [roomId: string]: Partial<IEvent>[] } = {};
    private clientOptions?: IStoredClientOpts;
    private pendingToDeviceBatches: IndexedToDeviceBatch[] = [];
    private nextToDeviceBatchId = 0;
    protected createUser?: UserCreator;

    /** 整体容量预算（对齐后端 max_capacity + 分区容量）。 */
    private readonly capacity: StoreCapacityConfig;

    /** OOB 成员 TTL 解析器（按 roomId 动态）。protected 供 IndexedDBStore 复用。 */
    protected readonly oobMembersTtl: OobMembersTtlProvider;

    /** 待发事件加密器（可选）。protected 供 IndexedDBStore 落盘路径使用。 */
    protected readonly pendingEventsCipher?: PendingEventsCipher;

    /** 无锁统计收集器（对齐后端 AtomicCacheStats）。protected 供子类埋点。 */
    protected readonly stats = new StoreStatsCollector();

    /**
     * Construct a new in-memory data store for the Matrix Client.
     * @param opts - Config options
     */
    public constructor(opts: IOpts = {}) {
        this.localStorage = opts.localStorage;
        this.capacity = { ...DEFAULT_STORE_CAPACITY, ...opts.capacity };
        this.oobMembersTtl = opts.oobMembersTtl ?? defaultOobMembersTtl;
        this.pendingEventsCipher = opts.pendingEventsCipher;

        // room / user 为活跃会话数据（无兜底数据源），只做容量预算 + LRU 淘汰，
        // 不做 TTL（避免误删活跃数据导致 UI 数据丢失）。
        this.rooms = new LruMap<string, Room>(this.capacity.maxRooms, (_roomId, room) => {
            this.stats.recordEvictions(1);
            // 解绑 storeRoom 挂的成员变更监听器，避免 room 被容量淘汰后监听器泄漏
            // （成员变更仍回调 store，累积泄漏）。
            room.currentState.off(RoomStateEvent.Members, this.onRoomMember);
        });
        this.users = new LruMap<string, User>(this.capacity.maxUsers, () => {
            this.stats.recordEvictions(1);
        });
        // OOB 成员是「可重新拉取」的缓存，TTL 按 roomId 动态解析（默认 room_members 900s）。
        this.oobMembers = new LruMap<string, IStateEventWithRoomId[]>(this.capacity.maxOutOfBandMembersRooms, () => {
            this.stats.recordEvictions(1);
        });
    }

    /**
     * Retrieve the token to stream from.
     * @returns The token or null.
     */
    public getSyncToken(): string | null {
        return this.syncToken;
    }

    /** @returns whether or not the database was newly created in this session. */
    public isNewlyCreated(): Promise<boolean> {
        return Promise.resolve(true);
    }

    /**
     * Set the token to stream from.
     * @param token - The token to stream from.
     */
    public setSyncToken(token: string): void {
        this.syncToken = token;
    }

    /**
     * Store the given room.
     * @param room - The room to be stored. All properties must be stored.
     */
    public storeRoom(room: Room): void {
        this.rooms.set(room.roomId, room);
        // add listeners for room member changes so we can keep the room member
        // map up-to-date.
        room.currentState.on(RoomStateEvent.Members, this.onRoomMember);
        // add existing members
        room.currentState.getMembers().forEach((m) => {
            this.onRoomMember(null, room.currentState, m);
        });
    }

    public setUserCreator(creator: UserCreator): void {
        this.createUser = creator;
    }

    /**
     * Called when a room member in a room being tracked by this store has been
     * updated.
     */
    private onRoomMember = (event: MatrixEvent | null, state: RoomState, member: RoomMember): void => {
        if (member.membership === KnownMembership.Invite) {
            // We do NOT add invited members because people love to typo user IDs
            // which would then show up in these lists (!)
            return;
        }

        // createUser 在 storeRoom 之前已通过 setUserCreator 赋值，此处非空断言。
        const user = this.users.get(member.userId) ?? this.createUser!(member.userId);
        if (member.name) {
            user.setDisplayName(member.name);
            if (member.events.member) {
                user.setRawDisplayName(member.events.member.getDirectionalContent().displayname);
            }
        }
        if (member.events.member && member.events.member.getContent().avatar_url) {
            user.setAvatarUrl(member.events.member.getContent().avatar_url);
        }
        this.users.set(user.userId, user);
    };

    /**
     * Retrieve a room by its' room ID.
     * @param roomId - The room ID.
     * @returns The room or null.
     */
    public getRoom(roomId: string): Room | null {
        const room = this.rooms.get(roomId);
        if (room) this.stats.recordHit();
        else this.stats.recordMiss();
        return room ?? null;
    }

    /**
     * Retrieve all known rooms.
     * @returns A list of rooms, which may be empty.
     */
    public getRooms(): Room[] {
        return Array.from(this.rooms.values());
    }

    /**
     * Permanently delete a room.
     */
    public removeRoom(roomId: string): void {
        const room = this.rooms.get(roomId);
        if (room) {
            room.currentState.removeListener(RoomStateEvent.Members, this.onRoomMember);
        }
        this.rooms.delete(roomId);
    }

    /**
     * Retrieve a summary of all the rooms.
     * @returns A summary of each room.
     */
    public getRoomSummaries(): RoomSummary[] {
        return Array.from(this.rooms.values()).map(function (room) {
            return room.summary!;
        });
    }

    /**
     * Store a User.
     * @param user - The user to store.
     */
    public storeUser(user: User): void {
        this.users.set(user.userId, user);
    }

    /**
     * Retrieve a User by its' user ID.
     * @param userId - The user ID.
     * @returns The user or null.
     */
    public getUser(userId: string): User | null {
        const user = this.users.get(userId);
        if (user) this.stats.recordHit();
        else this.stats.recordMiss();
        return user ?? null;
    }

    /**
     * Retrieve all known users.
     * @returns A list of users, which may be empty.
     */
    public getUsers(): User[] {
        return Array.from(this.users.values());
    }

    /**
     * Retrieve scrollback for this room.
     * @param _room - The matrix room
     * @param _limit - The max number of old events to retrieve.
     * @returns An array of objects which will be at most 'limit'
     * length and at least 0. The objects are the raw event JSON.
     */
    public scrollback(_room: Room, _limit: number): MatrixEvent[] {
        return [];
    }

    /**
     * Store events for a room. The events have already been added to the timeline
     * @param _room - The room to store events for.
     * @param _events - The events to store.
     * @param _token - The token associated with these events.
     * @param _toStart - True if these are paginated results.
     */
    public storeEvents(_room: Room, _events: MatrixEvent[], _token: string | null, _toStart: boolean): void {
        // no-op because they've already been added to the room instance.
    }

    /**
     * Store a filter.
     */
    public storeFilter(filter: Filter): void {
        if (!filter?.userId || !filter?.filterId) return;
        this.filters.getOrCreate(filter.userId).set(filter.filterId, filter);
    }

    /**
     * Retrieve a filter.
     * @returns A filter or null.
     */
    public getFilter(userId: string, filterId: string): Filter | null {
        return this.filters.get(userId)?.get(filterId) || null;
    }

    /**
     * Retrieve a filter ID with the given name.
     * @param filterName - The filter name.
     * @returns The filter ID or null.
     */
    public getFilterIdByName(filterName: string): string | null {
        if (!this.localStorage) {
            return null;
        }
        const key = "mxjssdk_memory_filter_" + filterName;
        // Defensive: Storage.getItem shouldn't throw, but we wrap in try-catch
        // for edge cases where localStorage might be corrupted or unavailable.
        try {
            const value = this.localStorage.getItem(key);
            if (isValidFilterId(value)) {
                return value;
            }
            // @swallow-error { owner: "store", expires: "2026-12-31" }
        } catch (error) {
            logger.warn(`Failed to get filter ID for ${filterName} from localStorage`, error);
        }
        return null;
    }

    /**
     * Set a filter name to ID mapping.
     */
    public setFilterIdByName(filterName: string, filterId?: string): void {
        if (!this.localStorage) {
            return;
        }
        const key = "mxjssdk_memory_filter_" + filterName;
        try {
            if (isValidFilterId(filterId)) {
                this.localStorage.setItem(key, filterId!);
            } else {
                this.localStorage.removeItem(key);
            }
        } catch (error) {
            logger.warn(`Failed to set filter ID for ${filterName} in localStorage`, error);
        }
    }

    /**
     * Store user-scoped account data events.
     * N.B. that account data only allows a single event per type, so multiple
     * events with the same type will replace each other.
     * @param events - The events to store.
     */
    public storeAccountDataEvents(events: MatrixEvent[]): void {
        events.forEach((event) => {
            // MSC3391: an event with content of {} should be interpreted as deleted
            const isDeleted = !Object.keys(event.getContent()).length;
            if (isDeleted) {
                this.accountData.delete(event.getType());
            } else {
                this.accountData.set(event.getType(), event);
            }
        });
    }

    /**
     * Get account data event by event type
     * @param eventType - The event type being queried
     * @returns the user account_data event of given type, if any
     */
    public getAccountData(eventType: EventType | string): MatrixEvent | undefined {
        return this.accountData.get(eventType);
    }

    /**
     * setSyncData does nothing as there is no backing data store.
     *
     * @param _syncData - The sync data
     * @returns An immediately resolved promise.
     */
    public setSyncData(_syncData: ISyncResponse): Promise<void> {
        return Promise.resolve();
    }

    /**
     * We never want to save becase we have nothing to save to.
     *
     * @returns If the store wants to save
     */
    public wantsSave(): boolean {
        return false;
    }

    /**
     * Save does nothing as there is no backing data store.
     * @param _force - True to force a save (but the memory
     *     store still can't save anything)
     */
    public save(_force: boolean): Promise<void> {
        return Promise.resolve();
    }

    /**
     * Startup does nothing as this store doesn't require starting up.
     * @returns An immediately resolved promise.
     */
    public startup(): Promise<void> {
        return Promise.resolve();
    }

    /**
     * @returns Promise which resolves with a sync response to restore the
     * client state to where it was at the last save, or null if there
     * is no saved sync data.
     */
    public getSavedSync(): Promise<ISavedSync | null> {
        return Promise.resolve(null);
    }

    /**
     * @returns If there is a saved sync, the nextBatch token
     * for this sync, otherwise null.
     */
    public getSavedSyncToken(): Promise<string | null> {
        return Promise.resolve(null);
    }

    /**
     * Delete all data from this store.
     * @returns An immediately resolved promise.
     */
    public deleteAllData(): Promise<void> {
        this.rooms.clear();
        this.users.clear();
        this.syncToken = null;
        this.filters = new MapWithDefault(() => new Map());
        this.accountData = new Map(); // type : content
        this.oobMembers.clear();
        this.pendingEvents = {};
        this.pendingToDeviceBatches = [];
        this.nextToDeviceBatchId = 0;
        this.stats.reset();
        return Promise.resolve();
    }

    /**
     * Returns the out-of-band membership events for this room that
     * were previously loaded.
     * @returns the events, potentially an empty array if OOB loading didn't yield any new members
     * @returns in case the members for this room haven't been stored yet
     */
    public getOutOfBandMembers(roomId: string): Promise<IStateEventWithRoomId[] | null> {
        const members = this.oobMembers.get(roomId);
        if (members !== undefined) {
            this.stats.recordHit();
            return Promise.resolve(members);
        }
        this.stats.recordMiss();
        return Promise.resolve(null);
    }

    /**
     * Stores the out-of-band membership events for this room. Note that
     * it still makes sense to store an empty array as the OOB status for the room is
     * marked as fetched, and getOutOfBandMembers will return an empty array instead of null
     * @param membershipEvents - the membership events to store
     * @returns when all members have been stored
     */
    public setOutOfBandMembers(roomId: string, membershipEvents: IStateEventWithRoomId[]): Promise<void> {
        // LruMap 内部做容量预算 + LRU 淘汰，超出上限时自动淘汰最久未访问条目，
        // 并经 onEvict 回调上报统计。TTL 按 roomId 动态解析（per-entry）。
        this.oobMembers.set(roomId, membershipEvents, this.oobMembersTtl(roomId));
        return Promise.resolve();
    }

    public clearOutOfBandMembers(roomId: string): Promise<void> {
        this.oobMembers.delete(roomId);
        return Promise.resolve();
    }

    public getClientOptions(): Promise<IStoredClientOpts | undefined> {
        return Promise.resolve(this.clientOptions);
    }

    public storeClientOptions(options: IStoredClientOpts): Promise<void> {
        this.clientOptions = Object.assign({}, options);
        return Promise.resolve();
    }

    public async getPendingEvents(roomId: string): Promise<Partial<IEvent>[]> {
        return this.pendingEvents[roomId] ?? [];
    }

    public async setPendingEvents(roomId: string, events: Partial<IEvent>[]): Promise<void> {
        // Trim to the most recent `maxPendingEventsPerRoom` entries (drop oldest).
        // ISSUE-11b: bound memory usage for rooms with very long pending backlogs.
        const cap = this.capacity.maxPendingEventsPerRoom;
        this.pendingEvents[roomId] = events.length > cap ? events.slice(-cap) : events;
    }

    public saveToDeviceBatches(batches: ToDeviceBatchWithTxnId[]): Promise<void> {
        for (const batch of batches) {
            this.pendingToDeviceBatches.push({
                id: this.nextToDeviceBatchId++,
                eventType: batch.eventType,
                txnId: batch.txnId,
                batch: batch.batch,
            });
        }
        return Promise.resolve();
    }

    public async getOldestToDeviceBatch(): Promise<IndexedToDeviceBatch | null> {
        if (this.pendingToDeviceBatches.length === 0) return null;
        return this.pendingToDeviceBatches[0];
    }

    public removeToDeviceBatch(id: number): Promise<void> {
        this.pendingToDeviceBatches = this.pendingToDeviceBatches.filter((batch) => batch.id !== id);
        return Promise.resolve();
    }

    /**
     * 返回 store 缓存统计快照，对齐后端 `CacheStats`。
     *
     * `totalEntries` 与 `memoryUsageBytes` 在此实时重算（而非每次写路径维护），
     * 保证与集合当前实际状态一致；`hits/misses/evictions` 来自无锁计数。
     */
    public getStats(): StoreStats {
        const totalEntries =
            this.rooms.size +
            this.users.size +
            this.accountData.size +
            this.oobMembers.size +
            Object.keys(this.pendingEvents).length +
            this.pendingToDeviceBatches.length;
        this.stats.setTotalEntries(totalEntries);
        this.stats.setMemoryUsageBytes(this.estimateMemoryUsageBytes());
        return this.stats.snapshot();
    }

    /**
     * 估算内存占用字节。仅 advisory，用于对齐后端 `memory_usage_bytes` 指标，
     * 不参与淘汰决策（见文件顶部估算常量说明）。
     */
    private estimateMemoryUsageBytes(): number {
        const roomCount = this.rooms.size;
        const userCount = this.users.size;
        const oobCount = this.oobMembers.size;
        const accountDataCount = this.accountData.size;
        const pendingCount = Object.values(this.pendingEvents).reduce((n, events) => n + events.length, 0);
        const toDeviceCount = this.pendingToDeviceBatches.length;
        return (
            roomCount * ESTIMATED_ROOM_BYTES +
            userCount * ESTIMATED_USER_BYTES +
            oobCount * ESTIMATED_OOB_MEMBER_BYTES +
            accountDataCount * ESTIMATED_ACCOUNT_DATA_BYTES +
            pendingCount * ESTIMATED_EVENT_BYTES +
            toDeviceCount * ESTIMATED_TO_DEVICE_BYTES
        );
    }

    public async destroy(): Promise<void> {
        // Nothing to do
    }
}
