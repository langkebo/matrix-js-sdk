import { logger } from "../logger"
import { MatrixClient } from "../client";
/*
Copyright 2024 The Matrix.org Foundation C.I.C.
*/

/**
 * Typing Manager - 打字提示管理
 * 
 * 提供房间内打字状态管理功能
 */

export interface TypingUser {
    userId: string
    timeout: number
}

export interface TypingOptions {
    timeout?: number // 毫秒
}

export class TypingManager {
    private client: any;
    private typingTimers: Map<string, NodeJS.Timeout> = new Map();

    constructor(client: any) {
        this.client = client;
    }

    /**
     * 开始打字
     */
    async startTyping(roomId: string, options?: TypingOptions): Promise<void> {
        const timeout = options?.timeout || 10000;
        
        // 清除之前的定时器
        const timerKey = `${roomId}`;
        if (this.typingTimers.has(timerKey)) {
            clearTimeout(this.typingTimers.get(timerKey)!);
        }

        try {
            await this.client.sendTyping(roomId, this.client.getUserId()!, timeout, true);
            
            // 设置自动停止打字
            const timer = setTimeout(async () => {
                await this.stopTyping(roomId);
            }, timeout);
            
            this.typingTimers.set(timerKey, timer);
        } catch (e) {
            logger.warn('TypingManager.startTyping failed:', e);
        }
    }

    /**
     * 停止打字
     */
    async stopTyping(roomId: string): Promise<void> {
        const timerKey = `${roomId}`;
        if (this.typingTimers.has(timerKey)) {
            clearTimeout(this.typingTimers.get(timerKey)!);
            this.typingTimers.delete(timerKey);
        }

        try {
            await this.client.sendTyping(roomId, this.client.getUserId()!, 0, false);
        } catch (e) {
            logger.warn('TypingManager.stopTyping failed:', e);
        }
    }

    /**
     * 获取房间内正在打字的用户
     */
    async getTypingUsers(roomId: string): Promise<TypingUser[]> {
        try {
            // 从 room 对象获取
            const room = this.client.getRoom(roomId);
            if (!room) return [];

            // 获取当前状态事件
            const event = room.currentState.getStateEvents('m.typing', this.client.getUserId());
            if (!event) return [];

            const content = event.getContent();
            return content.user_ids?.map((userId: string) => ({
                userId,
                timeout: content.timeout || 30000
            })) || [];
        } catch (e) {
            logger.warn('TypingManager.getTypingUsers failed:', e);
            return [];
        }
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
        return users.some(u => u.userId === userId);
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

declare module "../client.ts" {
    interface MatrixClient {
        getTypingManager(): TypingManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getTypingManager = function (): TypingManager {
        return new TypingManager(this);
    };
}

export default extendMatrixClient;
