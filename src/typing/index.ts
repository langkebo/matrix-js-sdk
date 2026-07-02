import { logger } from "../logger";
import { MatrixClient } from "../client";
import type { IContent } from "../models/event";
import { BaseManager } from "../managers/base-manager";
import { validateUserId, validateRoomId } from "../common/validators";
import { Method } from "../http-api";
import { ClientPrefix } from "../http-api/prefix";
import type { TypingPathPattern } from "./__generated__/route-table";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { ValidationError } from "../errors";
import type { EmptyObject } from "../@types/common";
/*
Copyright 2024 The Matrix.org Foundation C.I.C.
*/

/**
 * Typing Manager - 打字提示管理
 *
 * 提供房间内打字状态管理功能
 */

export interface TypingUser {
    userId: string;
    timeout: number;
}

export interface TypingOptions {
    timeout?: number; // 毫秒
}

interface TypingResponseBody {
    user_ids?: string[];
    typing?: string[];
    timeout?: number;
}

interface BatchTypingResponseBody {
    rooms?: Record<string, TypingResponseBody>;
}

type StripV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;

function tp<P extends StripV3<TypingPathPattern>>(path: P): P {
    return path;
}

export class TypingManager extends BaseManager {
    private typingTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
    // 节流：记录每个房间最近一次发送 typing=true 的时间戳
    // Matrix 协议建议 typing 通知发送间隔不少于 ~10 秒
    private lastTypingSendTime: Map<string, number> = new Map();
    private readonly TYPING_THROTTLE_MS = 10000;

    constructor(client: MatrixClient) {
        super(client);
    }

    /**
     * Send a typing notification to a room.
     * PUT /_matrix/client/v3/rooms/{roomId}/typing/{userId}
     *
     * @param roomId - The room ID
     * @param isTyping - Whether the user is typing
     * @param timeoutMs - The length of time in milliseconds to mark this user as typing
     * @returns Promise which resolves to an empty object if successful
     */
    async sendTyping(roomId: string, isTyping: boolean, timeoutMs: number): Promise<EmptyObject> {
        if (this.client.isGuest()) {
            return {}; // guests cannot send typing notifications so don't bother.
        }
        const userId = this.client.getUserId();
        if (!userId) {
            throw new ValidationError("User ID is required");
        }

        // 节流：如果是 typing=true 且距上次发送不足 TYPING_THROTTLE_MS，跳过本次请求
        // typing=false（停止打字）始终立即发送，不受节流限制
        if (isTyping) {
            const now = Date.now();
            const lastSend = this.lastTypingSendTime.get(roomId) ?? 0;
            if (now - lastSend < this.TYPING_THROTTLE_MS) {
                logger.debug(`TypingManager.sendTyping throttled for room ${roomId}, skipping`);
                return {};
            }
            this.lastTypingSendTime.set(roomId, now);
        } else {
            this.lastTypingSendTime.delete(roomId);
        }

        const path = tp(`/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(userId)}`);
        const data: IContent = { typing: isTyping };
        if (isTyping) {
            data.timeout = timeoutMs ? timeoutMs : 20000;
        }
        return this.withRetry(async () => {
            return await this.client.http.authedRequest<EmptyObject>(
                Method.Put,
                path,
                undefined,
                data,
                { prefix: ClientPrefix.V3 },
            );
        }, "sendTyping");
    }

    /**
     * POST variant of sendTyping.
     * Convenience method that uses POST instead of PUT for the same endpoint.
     *
     * @param roomId - The room ID
     * @param userId - The user ID
     * @param isTyping - Whether the user is typing
     * @param timeoutMs - The length of time in milliseconds to mark this user as typing
     * @returns Promise which resolves to an empty object if successful
     */
    async postTyping(roomId: string, userId: string, isTyping: boolean, timeoutMs?: number): Promise<EmptyObject> {
        if (this.client.isGuest()) {
            return {};
        }
        const path = tp(`/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(userId)}`);
        const data: IContent = { typing: isTyping };
        if (isTyping) {
            data.timeout = timeoutMs ? timeoutMs : 20000;
        }
        return this.withRetry(async () => {
            return await this.client.http.authedRequest<EmptyObject>(
                Method.Post,
                path,
                undefined,
                data,
                { prefix: ClientPrefix.V3 },
            );
        }, "postTyping");
    }

    /**
     * 开始打字提示
     *
     * @param roomId - 房间 ID（格式：!localpart:homeserver）
     * @param options - 选项
     * @param options.timeout - 超时时间（毫秒，默认 30000，与后端 `typing.rs` 默认值一致）
     *
     * @example
     * ```typescript
     * // 开始打字（默认 30 秒超时）
     * await typingManager.startTyping("!abc:example.com");
     *
     * // 自定义超时时间
     * await typingManager.startTyping("!abc:example.com", { timeout: 5000 });
     *
     * // 自动停止打字（超时后）
     * await typingManager.startTyping("!abc:example.com", { timeout: 3000 });
     * // 3 秒后自动停止
     * ```
     *
     * @throws {ValidationError} 如果房间 ID 格式无效
     * @throws {AuthError} 如果用户未登录
     */
    async startTyping(roomId: string, options?: TypingOptions): Promise<void> {
        validateRoomId(roomId);
        const timeout = options?.timeout || 30000;

        // 清除之前的定时器
        const timerKey = `${roomId}`;
        if (this.typingTimers.has(timerKey)) {
            clearTimeout(this.typingTimers.get(timerKey)!);
        }

        try {
            const userId = this.client.getUserId();
            if (!userId) {
                throw new ValidationError("User ID is required");
            }
            await this.sendTyping(roomId, true, timeout);

            // 设置自动停止打字
            const timer = setTimeout(async () => {
                await this.stopTyping(roomId);
            }, timeout);

            this.typingTimers.set(timerKey, timer);
        } catch (e) {
            logger.warn("TypingManager.startTyping failed:", this.normalizeError(e, "startTyping"));
        }
    }

    /**
     * 停止打字提示
     *
     * @param roomId - 房间 ID（格式：!localpart:homeserver）
     *
     * @example
     * ```typescript
     * // 停止打字
     * await typingManager.stopTyping("!abc:example.com");
     * ```
     *
     * @throws {ValidationError} 如果房间 ID 格式无效
     */
    async stopTyping(roomId: string): Promise<void> {
        validateRoomId(roomId);
        const timerKey = `${roomId}`;
        if (this.typingTimers.has(timerKey)) {
            clearTimeout(this.typingTimers.get(timerKey)!);
            this.typingTimers.delete(timerKey);
        }

        try {
            await this.sendTyping(roomId, false, 0);
        } catch (e) {
            logger.warn("TypingManager.stopTyping failed:", this.normalizeError(e, "stopTyping"));
        }
    }

    /**
     * 获取房间内正在打字的用户列表
     *
     * @param roomId - 房间 ID（格式：!localpart:homeserver）
     * @returns 正在打字的用户列表
     *
     * @example
     * ```typescript
     * // 获取正在打字的用户
     * const typingUsers = await typingManager.getTypingUsers("!abc:example.com");
     * typingUsers.forEach(user => {
     *     console.log(`${user.userId} is typing (timeout: ${user.timeout}ms)`);
     * });
     * ```
     *
     * @throws {ValidationError} 如果房间 ID 格式无效
     */
    async getTypingUsers(roomId: string): Promise<TypingUser[]> {
        validateRoomId(roomId);
        const room = this.client.getRoom(roomId);
        if (!room) return [];

        const userId = this.client.getUserId();
        if (!userId) return [];
        const event = room.currentState.getStateEvents("m.typing", userId);
        if (!event) return [];

        const content = event.getContent<{ user_ids?: string[]; timeout?: number }>();
        if (!Array.isArray(content.user_ids)) return [];

        return content.user_ids.map((typingUserId: string) => ({
            userId: typingUserId,
            timeout: content.timeout || 30000,
        }));
    }

    /**
     * 批量获取多个房间的打字状态
     */
    async getRoomsTyping(rooms: string[]): Promise<Map<string, TypingUser[]>> {
        const result = new Map<string, TypingUser[]>();

        for (const roomId of rooms) {
            const users = await this.getTypingUsers(roomId);
            if (users.length > 0) {
                result.set(roomId, users);
            }
        }

        return result;
    }

    /**
     * 检查用户是否正在打字
     */
    async isUserTyping(roomId: string, userId: string): Promise<boolean> {
        const users = await this.getTypingUsers(roomId);
        return users.some((u) => u.userId === userId);
    }

    /**
     * 从服务器拉取房间内正在打字的用户列表（GET /rooms/{room_id}/typing）。
     *
     * 与 `getTypingUsers` 不同，此方法绕过本地 `m.typing` 缓存，直接向后端
     * 发起请求，适用于 sync 还未完成或需要实时数据的场景。
     */
    async fetchTypingUsers(roomId: string): Promise<TypingUser[]> {
        validateRoomId(roomId);
        const path = tp(`/rooms/${encodeURIComponent(roomId)}/typing`);
        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<TypingResponseBody>(
                Method.Get,
                path,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        }, "fetchTypingUsers");
        const users = Array.isArray(response?.user_ids) ? response.user_ids : Array.isArray(response?.typing) ? response.typing : [];
        const timeout = response?.timeout ?? 30000;
        return users.map((userId: string) => ({ userId, timeout }));
    }

    /**
     * 查询单个用户是否在某个房间内打字（GET /rooms/{room_id}/typing/{user_id}）。
     */
    async fetchUserTyping(roomId: string, userId: string): Promise<boolean> {
        validateRoomId(roomId);
        validateUserId(userId);
        const path = tp(`/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(userId)}`);
        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<{ typing?: boolean }>(
                Method.Get,
                path,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        }, "fetchUserTyping");
        return response?.typing === true;
    }

    /**
     * 批量查询多个房间的打字状态（POST /rooms/typing）。
     *
     * 返回值为 roomId -> TypingUser[] 的映射。
     */
    async fetchRoomsTyping(rooms: string[]): Promise<Map<string, TypingUser[]>> {
        for (const roomId of rooms) {
            validateRoomId(roomId);
        }
        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<BatchTypingResponseBody | Record<string, TypingResponseBody>>(
                Method.Post,
                tp("/rooms/typing"),
                undefined,
                { rooms: rooms },
                { prefix: ClientPrefix.V3 },
            );
        }, "fetchRoomsTyping");

        const result = new Map<string, TypingUser[]>();
        const roomEntries = (response && "rooms" in response && response.rooms ? response.rooms : response ?? {}) as Record<
            string,
            TypingResponseBody
        >;
        for (const [roomId, entry] of Object.entries(roomEntries)) {
            const users = Array.isArray(entry?.user_ids) ? entry.user_ids : Array.isArray(entry?.typing) ? entry.typing : [];
            const timeout = entry?.timeout ?? 30000;
            result.set(
                roomId,
                users.map((typingUserId: string) => ({ userId: typingUserId, timeout })),
            );
        }
        return result;
    }

    /**
     * 清除所有打字定时器
     */
    clearAllTimers(): void {
        for (const timer of this.typingTimers.values()) {
            clearTimeout(timer);
        }
        this.typingTimers.clear();
    }

    start(): void {
        // 可以添加事件监听
    }

    stop(): void {
        this.clearAllTimers();
    }
}


export function extendMatrixClient(): void {
    MatrixClient.prototype.getTypingManager = function (): TypingManager {
        registerManagerClass("typing", TypingManager);
    return getOrCreateManager(this, "typing", () => new TypingManager(this));
    };

    MatrixClient.prototype.sendTyping = function (
        this: MatrixClient,
        roomId: string,
        isTyping: boolean,
        timeoutMs?: number,
    ): Promise<import("../@types/common").EmptyObject> {
        return this.getTypingManager().sendTyping(roomId, isTyping, timeoutMs ?? 30000);
    };
}

export default extendMatrixClient;
