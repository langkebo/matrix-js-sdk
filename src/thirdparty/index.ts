import { logger } from "../logger"
/*
Copyright 2024 The Matrix.org Foundation C.I.C.
*/

/**
 * ThirdParty Manager - 第三方服务管理
 * 
 * 提供第三方协议和 bridges 管理功能
 */

export interface ThirdPartyProtocol {
    protocol: string
    description?: string
    fields: {
        [key: string]: {
            type: string
            regex?: string
            placeholder?: string
            required?: boolean
        }
    }
    objects?: Array<{
        id: string
        name: string
        fields: Record<string, any>
    }>
}

export interface ThirdPartyLocation {
    alias: string
    protocol: string
    fields: Record<string, any>
    info?: {
        [key: string]: any
    }
}

export interface ThirdPartyUser {
    userid: string
    protocol: string
    fields: Record<string, any>
    display_name?: string
    avatar_url?: string
}

export interface ThirdPartySearchParams {
    [key: string]: string
}

export class ThirdPartyManager {
    private client: any;

    constructor(client: any) {
        this.client = client;
    }

    /**
     * 获取支持的第三方协议
     */
    async getProtocols(): Promise<ThirdPartyProtocol[]> {
        try {
            const protocols = await this.client.getThirdPartyProtocols();
            return Object.entries(protocols).map(([name, data]) => ({
                protocol: name,
                ...(data as any)
            }));
        } catch (e) {
            logger.warn('ThirdPartyManager.getProtocols failed:', e);
            return [];
        }
    }

    /**
     * 获取单个协议信息
     */
    async getProtocol(protocol: string): Promise<ThirdPartyProtocol | null> {
        try {
            const protocols = await this.getProtocols();
            return protocols.find(p => p.protocol === protocol) || null;
        } catch (e) {
            logger.warn('ThirdPartyManager.getProtocol failed:', e);
            return null;
        }
    }

    /**
     * 搜索第三方位置（bridges）
     */
    async searchLocations(
        protocol: string,
        params: ThirdPartySearchParams
    ): Promise<ThirdPartyLocation[]> {
        try {
            return await this.client.getThirdPartyLocation(protocol, params);
        } catch (e) {
            logger.warn('ThirdPartyManager.searchLocations failed:', e);
            return [];
        }
    }

    /**
     * 搜索第三方用户
     */
    async searchUsers(
        protocol: string,
        params: ThirdPartySearchParams
    ): Promise<ThirdPartyUser[]> {
        try {
            return await this.client.getThirdPartyUser(protocol, params);
        } catch (e) {
            logger.warn('ThirdPartyManager.searchUsers failed:', e);
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
                    protocol: 'matrix',
                    fields: { room_id: roomId.room_id },
                    info: room ? {
                        name: room.name,
                        topic: room.topic,
                        avatar_url: room.avatarUrl
                    } : undefined
                };
            }
            return null;
        } catch (e) {
            logger.warn('ThirdPartyManager.getLocation failed:', e);
            return null;
        }
    }

    /**
     * 获取用户信息
     */
    async getUser(userId: string): Promise<ThirdPartyUser | null> {
        try {
            // 检查是否是第三方用户
            if (userId.includes(':')) {
                const [localpart, server] = userId.split(':');
                // 尝试从协议获取用户
                return {
                    userid: userId,
                    protocol: 'matrix',
                    fields: { localpart, server }
                };
            }
            return null;
        } catch (e) {
            logger.warn('ThirdPartyManager.getUser failed:', e);
            return null;
        }
    }

    /**
     * 解析第三方统一标识符
     */
    async parseMatrixUri(uri: string): Promise<{
        type: 'user' | 'room' | 'event'
        id: string
        fields?: Record<string, any>
    } | null> {
        try {
            // 简单解析 matrix: URIs
            if (uri.startsWith('matrix:')) {
                const parts = uri.replace('matrix:', '').split('?');
                const path = parts[0];
                
                if (path.startsWith('u/')) {
                    return { type: 'user', id: path.replace('u/', '') };
                } else if (path.startsWith('r/')) {
                    return { type: 'room', id: path.replace('r/', '') };
                } else if (path.startsWith('e/')) {
                    const [roomId, eventId] = path.replace('e/', '').split('/');
                    return { type: 'event', id: eventId, fields: { room_id: roomId } };
                }
            }
            return null;
        } catch (e) {
            logger.warn('ThirdPartyManager.parseMatrixUri failed:', e);
            return null;
        }
    }

    /**
     * 生成第三方统一标识符
     */
    encodeMatrixUri(
        type: 'user' | 'room' | 'event',
        id: string,
        params?: Record<string, string>
    ): string {
        let path = '';
        switch (type) {
            case 'user':
                path = `u/${id}`;
                break;
            case 'room':
                path = `r/${id}`;
                break;
            case 'event':
                path = `e/${id}`;
                break;
        }
        
        let uri = `matrix:${path}`;
        if (params) {
            const query = Object.entries(params)
                .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
                .join('&');
            uri += '?' + query;
        }
        
        return uri;
    }

    start(): void {}
    stop(): void {}
}
