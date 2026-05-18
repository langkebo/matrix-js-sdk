/*
Copyright 2021 Šimon Brandner <simon.bra.ag@gmail.com>

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

import { type MatrixEvent } from "../models/event";
import { type MatrixClient, ClientEvent } from "../client";
import {
    GroupCall,
    GroupCallIntent,
    GroupCallType,
    type IGroupCallDataChannelOptions,
    type IGroupCallRoomState,
} from "./groupCall";
import { type Room } from "../models/room";
import { type RoomState, RoomStateEvent } from "../models/room-state";
import { type RoomMember } from "../models/room-member";
import { logger } from "../logger";
import { EventType } from "../@types/event";
import { SyncState } from "../sync";

function isGroupCallType(value: unknown): value is GroupCallType {
    return typeof value === "string" && Object.values(GroupCallType).includes(value as GroupCallType);
}

function isGroupCallIntent(value: unknown): value is GroupCallIntent {
    return typeof value === "string" && Object.values(GroupCallIntent).includes(value as GroupCallIntent);
}

function parseDataChannelOptions(value: unknown): IGroupCallDataChannelOptions | undefined {
    if (!value || typeof value !== "object") {
        return undefined;
    }

    const options = value as Partial<IGroupCallDataChannelOptions>;
    if (
        typeof options.ordered !== "boolean" ||
        typeof options.maxPacketLifeTime !== "number" ||
        typeof options.maxRetransmits !== "number" ||
        typeof options.protocol !== "string"
    ) {
        return undefined;
    }

    return {
        ordered: options.ordered,
        maxPacketLifeTime: options.maxPacketLifeTime,
        maxRetransmits: options.maxRetransmits,
        protocol: options.protocol,
    };
}

export enum GroupCallEventHandlerEvent {
    Incoming = "GroupCall.incoming",
    Outgoing = "GroupCall.outgoing",
    Ended = "GroupCall.ended",
    Participants = "GroupCall.participants",
}

export type GroupCallEventHandlerEventHandlerMap = {
    [GroupCallEventHandlerEvent.Incoming]: (call: GroupCall) => void;
    [GroupCallEventHandlerEvent.Outgoing]: (call: GroupCall) => void;
    [GroupCallEventHandlerEvent.Ended]: (call: GroupCall) => void;
    [GroupCallEventHandlerEvent.Participants]: (participants: RoomMember[], call: GroupCall) => void;
};

interface RoomDeferred {
    prom: Promise<void>;
    resolve?: () => void;
}

export class GroupCallEventHandler {
    public groupCalls = new Map<string, GroupCall>(); // roomId -> GroupCall

    // All rooms we know about and whether we've seen a 'Room' event
    // for them. The promise will be fulfilled once we've processed that
    // event which means we're "up to date" on what calls are in a room
    // and get
    private roomDeferreds = new Map<string, RoomDeferred>();

    public constructor(private client: MatrixClient) {}

    public async start(): Promise<void> {
        // We wait until the client has started syncing for real.
        // This is because we only support one call at a time, and want
        // the latest. We therefore want the latest state of the room before
        // we create a group call for the room so we can be fairly sure that
        // the group call we create is really the latest one.
        if (this.client.getSyncState() !== SyncState.Syncing) {
            logger.debug("GroupCallEventHandler start() waiting for client to start syncing");
            await new Promise<void>((resolve) => {
                const onSync = (): void => {
                    if (this.client.getSyncState() === SyncState.Syncing) {
                        this.client.off(ClientEvent.Sync, onSync);
                        return resolve();
                    }
                };
                this.client.on(ClientEvent.Sync, onSync);
            });
        }

        const rooms = this.client.getRooms();

        for (const room of rooms) {
            this.createGroupCallForRoom(room);
        }

        this.client.on(ClientEvent.Room, this.onRoomsChanged);
        this.client.on(RoomStateEvent.Events, this.onRoomStateChanged);
    }

    public stop(): void {
        this.client.removeListener(ClientEvent.Room, this.onRoomsChanged);
        this.client.removeListener(RoomStateEvent.Events, this.onRoomStateChanged);
    }

    private getRoomDeferred(roomId: string): RoomDeferred {
        let deferred = this.roomDeferreds.get(roomId);
        if (deferred === undefined) {
            let resolveFunc: () => void;
            deferred = {
                prom: new Promise<void>((resolve) => {
                    resolveFunc = resolve;
                }),
            };
            deferred.resolve = resolveFunc!;
            this.roomDeferreds.set(roomId, deferred);
        }

        return deferred;
    }

    public waitUntilRoomReadyForGroupCalls(roomId: string): Promise<void> {
        return this.getRoomDeferred(roomId).prom;
    }

    public getGroupCallById(groupCallId: string): GroupCall | undefined {
        return [...this.groupCalls.values()].find((groupCall) => groupCall.groupCallId === groupCallId);
    }

    private createGroupCallForRoom(room: Room): void {
        const callEvents = room.currentState.getStateEvents(EventType.GroupCallPrefix);
        const sortedCallEvents = callEvents.sort((a, b) => b.getTs() - a.getTs());

        for (const callEvent of sortedCallEvents) {
            const content = callEvent.getContent();

            if (content["m.terminated"] || callEvent.isRedacted()) {
                continue;
            }

            logger.debug(
                `GroupCallEventHandler createGroupCallForRoom() choosing group call from possible calls (stateKey=${callEvent.getStateKey()}, ts=${callEvent.getTs()}, roomId=${
                    room.roomId
                }, numOfPossibleCalls=${callEvents.length})`,
            );

            this.createGroupCallFromRoomStateEvent(callEvent);
            break;
        }

        this.getRoomDeferred(room.roomId).resolve!();
    }

    private createGroupCallFromRoomStateEvent(event: MatrixEvent): GroupCall | undefined {
        const roomId = event.getRoomId();
        const content = event.getContent<Partial<IGroupCallRoomState>>();

        const room = this.client.getRoom(roomId);

        if (!room) {
            logger.warn(
                `GroupCallEventHandler createGroupCallFromRoomStateEvent() couldn't find room for call (roomId=${roomId})`,
            );
            return;
        }

        const groupCallId = event.getStateKey();

        const callType = content["m.type"];

        if (!isGroupCallType(callType)) {
            logger.warn(
                `GroupCallEventHandler createGroupCallFromRoomStateEvent() received invalid call type (type=${callType}, roomId=${roomId})`,
            );
            return;
        }

        const callIntent = content["m.intent"];

        if (!isGroupCallIntent(callIntent)) {
            logger.warn(`Received invalid group call intent (type=${callType}, roomId=${roomId})`);
            return;
        }

        const isPtt = Boolean(content["io.element.ptt"]);

        let dataChannelOptions: IGroupCallDataChannelOptions | undefined;

        if (content?.dataChannelsEnabled && content?.dataChannelOptions) {
            dataChannelOptions = parseDataChannelOptions(content.dataChannelOptions);
        }

        const groupCall = new GroupCall(
            this.client,
            room,
            callType,
            isPtt,
            callIntent,
            groupCallId,
            // Because without Media section a WebRTC connection is not possible, so need a RTCDataChannel to set up a
            // no media WebRTC connection anyway.
            content?.dataChannelsEnabled || this.client.isVoipWithNoMediaAllowed,
            dataChannelOptions,
            this.client.isVoipWithNoMediaAllowed,
            this.client.useLivekitForGroupCalls,
            content["io.element.livekit_service_url"],
        );

        this.groupCalls.set(room.roomId, groupCall);
        this.client.emit(GroupCallEventHandlerEvent.Incoming, groupCall);

        return groupCall;
    }

    private onRoomsChanged = (room: Room): void => {
        this.createGroupCallForRoom(room);
    };

    private onRoomStateChanged = (event: MatrixEvent, state: RoomState): void => {
        const eventType = event.getType();

        if (eventType === EventType.GroupCallPrefix) {
            const groupCallId = event.getStateKey();
            const content = event.getContent();

            const currentGroupCall = this.groupCalls.get(state.roomId);

            if (!currentGroupCall && !content["m.terminated"] && !event.isRedacted()) {
                this.createGroupCallFromRoomStateEvent(event);
            } else if (currentGroupCall && currentGroupCall.groupCallId === groupCallId) {
                if (content["m.terminated"] || event.isRedacted()) {
                    currentGroupCall.terminate(false);
                } else if (content["m.type"] !== currentGroupCall.type) {
                    // Known limitation: call type changes from room state are not handled.
                    logger.warn(
                        `GroupCallEventHandler onRoomStateChanged() currently does not support changing type (roomId=${state.roomId})`,
                    );
                }
            } else if (currentGroupCall && currentGroupCall.groupCallId !== groupCallId) {
                // Known limitation: additional concurrent group calls are not handled.
                logger.warn(
                    `GroupCallEventHandler onRoomStateChanged() currently does not support multiple calls (roomId=${state.roomId})`,
                );
            }
        }
    };
}
