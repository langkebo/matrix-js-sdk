/*
Copyright 2024 The Matrix.org Foundation C.I.C.
*/

/**
 * Room Summary Manager - 房间摘要管理
 */

export interface RoomSummary {
    room_id: string
    name?: string
    topic?: string
    avatar_url?: string
    join_rule?: string
    member_count?: number
    invited_member_count?: number
    joined_member_count?: number
    world_readable?: boolean
    guest_can_join?: boolean
    heroes?: Array<{ user_id: string; avatar_url?: string; name?: string }>
    is_exposed?: boolean
    room_type?: string
    membership?: string
}

export interface RoomSummaryOptions {
    limit?: number
    maxJoinedMembers?: number
    suggested?: boolean
    includeAllFields?: boolean
}

export class RoomSummaryManager {
    private client: any;

    constructor(client: any) {
        this.client = client;
    }

    async getRoomSummary(roomId: string): Promise<RoomSummary | null> {
        try {
            return await this.client.getRoomSummary(roomId);
        } catch (e) {
            return null;
        }
    }

    async getRoomHierarchy(roomId: string, options?: RoomSummaryOptions): Promise<any | null> {
        try {
            const params: Record<string, any> = {};
            if (options?.limit) params.limit = options.limit;
            if (options?.maxJoinedMembers) params.max_joined_members = options.maxJoinedMembers;
            if (options?.suggested) params.suggested = options.suggested;
            if (options?.includeAllFields) params.include_all_fields = options.includeAllFields;
            return await this.client.getRoomHierarchy(roomId, params);
        } catch (e) {
            return null;
        }
    }

    async getPublicRooms(server: string = '', options?: { limit?: number; since?: string; query?: string }): Promise<any | null> {
        try {
            const params: Record<string, any> = {};
            if (options?.limit) params.limit = options.limit;
            if (options?.since) params.since = options.since;
            if (options?.query) params.query = options.query;
            return await this.client.publicRooms(server, params);
        } catch (e) {
            return null;
        }
    }

    async searchPublicRooms(query: string, server: string = '', limit: number = 20): Promise<RoomSummary[]> {
        try {
            const result = await this.getPublicRooms(server, { query, limit });
            return result?.chunk || [];
        } catch (e) {
            return [];
        }
    }

    async getRecommendedRooms(server: string = '', limit: number = 20): Promise<RoomSummary[]> {
        try {
            const result = await this.getPublicRooms(server, { limit });
            return result?.chunk || [];
        } catch (e) {
            return [];
        }
    }

    async getFavoriteRooms(): Promise<RoomSummary[]> {
        try {
            const rooms = this.client.getRooms() as any[];
            return rooms
                .filter((room: any) => room.tags && room.tags['m.favorite'])
                .map((room: any) => ({
                    room_id: room.roomId,
                    name: room.name,
                    topic: room.topic,
                    avatar_url: room.avatarUrl,
                    member_count: room.getJoinedMemberCount?.() || 0
                }));
        } catch (e) {
            return [];
        }
    }

    async getRecentRooms(limit: number = 10): Promise<RoomSummary[]> {
        try {
            const rooms = this.client.getRooms() as any[];
            return rooms
                .filter((room: any) => room.getLastActiveTimestamp?.())
                .sort((a: any, b: any) => (b.getLastActiveTimestamp?.() || 0) - (a.getLastActiveTimestamp?.() || 0))
                .slice(0, limit)
                .map((room: any) => ({
                    room_id: room.roomId,
                    name: room.name,
                    topic: room.topic,
                    avatar_url: room.avatarUrl,
                    member_count: room.getJoinedMemberCount?.() || 0,
                    membership: room.getMyMembership?.() || 'join'
                }));
        } catch (e) {
            return [];
        }
    }

    start(): void {}
    stop(): void {}
}
