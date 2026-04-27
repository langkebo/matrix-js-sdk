import { logger } from "../logger";
import { TypedEventEmitter } from "../models/typed-event-emitter.ts";
import { MatrixClient } from "../client";
import { Room } from "../models/room";
import { Direction } from "../models/event-timeline";

export enum InviteListEvent {
    InviteReceived = "InviteReceived",
    InviteAccepted = "InviteAccepted",
    InviteRejected = "InviteRejected",
    InviteListUpdated = "InviteListUpdated",
    InviteError = "InviteError",
}

export interface IInviteInfo {
    roomId: string;
    roomName?: string;
    inviterId: string;
    inviterName?: string;
    timestamp: number;
    isDirect?: boolean;
}

export interface IInviteListResponse {
    rooms: IInviteInfo[];
}

interface InviteListManagerEventMap {
    [InviteListEvent.InviteReceived]: (invite: IInviteInfo) => void;
    [InviteListEvent.InviteAccepted]: (roomId: string) => void;
    [InviteListEvent.InviteRejected]: (roomId: string) => void;
    [InviteListEvent.InviteListUpdated]: (invites: IInviteInfo[]) => void;
    [InviteListEvent.InviteError]: (error: Error) => void;
}

export class InviteListManager extends TypedEventEmitter<InviteListEvent, InviteListManagerEventMap> {
    private client: MatrixClient;
    private invites: Map<string, IInviteInfo> = new Map();
    private initialized: boolean = false;

    constructor(client: MatrixClient) {
        super();
        this.client = client;
    }

    async getInvites(): Promise<IInviteInfo[]> {
        try {
            const rooms = this.client.getRooms?.() || [];
            const invites: IInviteInfo[] = [];

            for (const room of rooms) {
                if (room.getMyMembership?.() === "invite") {
                    const invite = await this.buildInviteInfo(room);
                    invites.push(invite);
                    this.invites.set(invite.roomId, invite);
                }
            }

            this.emit(InviteListEvent.InviteListUpdated, invites);

            return invites;
        } catch (e) {
            logger.warn("InviteListManager.getInvites failed:", e);
            return Array.from(this.invites.values());
        }
    }

    private async buildInviteInfo(room: Room): Promise<IInviteInfo> {
        const roomId = room.roomId;
        const inviteState = room.getLiveTimeline?.()?.getState?.(Direction.Forward) || room.currentState;

        let inviterId = "";
        let inviterName = "";

        const memberEvents = inviteState?.getStateEvents?.("m.room.member") || [];
        for (const event of memberEvents) {
            const content = event.getContent?.();
            if (content?.membership === "invite" && event.getStateKey?.() === this.client.getUserId()) {
                inviterId = event.getSender?.() || "";
                break;
            }
        }

        if (inviterId) {
            const inviterMember = inviteState.getMember?.(inviterId);
            inviterName = inviterMember?.name || inviterId;
        }

        const roomNameEvent = inviteState.getStateEvents?.("m.room.name", "");
        const roomName = roomNameEvent?.getContent?.<{ name?: string }>()?.name || room.name || roomId;

        const mDirectEvent = this.client.getAccountData?.("m.direct");
        const directRooms = mDirectEvent?.getContent?.() as Record<string, string[]> | undefined;
        const isDirect = directRooms
            ? Object.values(directRooms).some((users) => users.includes(this.client.getUserId() || ""))
            : false;

        return {
            roomId,
            roomName,
            inviterId,
            inviterName,
            timestamp: Date.now(),
            isDirect,
        };
    }

    async acceptInvite(roomId: string): Promise<void> {
        if (!roomId) {
            throw new Error("Room ID is required");
        }

        try {
            await this.client.joinRoom(roomId);

            this.invites.delete(roomId);
            this.emit(InviteListEvent.InviteAccepted, roomId);
            this.emit(InviteListEvent.InviteListUpdated, Array.from(this.invites.values()));
        } catch (error) {
            this.emit(InviteListEvent.InviteError, error as Error);
            throw error;
        }
    }

    async rejectInvite(roomId: string): Promise<void> {
        if (!roomId) {
            throw new Error("Room ID is required");
        }

        try {
            await this.client.leave(roomId);

            this.invites.delete(roomId);
            this.emit(InviteListEvent.InviteRejected, roomId);
            this.emit(InviteListEvent.InviteListUpdated, Array.from(this.invites.values()));
        } catch (error) {
            this.emit(InviteListEvent.InviteError, error as Error);
            throw error;
        }
    }

    async acceptAllInvites(): Promise<void> {
        const invites = Array.from(this.invites.keys());

        for (const roomId of invites) {
            try {
                await this.acceptInvite(roomId);
            } catch (e) {
                logger.warn(`Failed to accept invite for room ${roomId}:`, e);
            }
        }
    }

    async rejectAllInvites(): Promise<void> {
        const invites = Array.from(this.invites.keys());

        for (const roomId of invites) {
            try {
                await this.rejectInvite(roomId);
            } catch (e) {
                logger.warn(`Failed to reject invite for room ${roomId}:`, e);
            }
        }
    }

    getInvite(roomId: string): IInviteInfo | null {
        return this.invites.get(roomId) || null;
    }

    hasInvite(roomId: string): boolean {
        return this.invites.has(roomId);
    }

    getInviteCount(): number {
        return this.invites.size;
    }

    getCachedInvites(): IInviteInfo[] {
        return Array.from(this.invites.values());
    }

    handleInvite(roomId: string, invite: IInviteInfo): void {
        this.invites.set(roomId, invite);
        this.emit(InviteListEvent.InviteReceived, invite);
        this.emit(InviteListEvent.InviteListUpdated, Array.from(this.invites.values()));
    }

    handleMembershipChange(roomId: string, membership: string): void {
        if (membership !== "invite" && this.invites.has(roomId)) {
            this.invites.delete(roomId);
            this.emit(InviteListEvent.InviteListUpdated, Array.from(this.invites.values()));
        }
    }

    clear(): void {
        this.invites.clear();
    }

    async start(): Promise<void> {
        if (this.initialized) return;

        try {
            await this.getInvites();
            this.initialized = true;
        } catch (e) {
            logger.warn("InviteListManager.start failed:", e);
        }
    }

    stop(): void {
        this.invites.clear();
        this.initialized = false;
    }
}
