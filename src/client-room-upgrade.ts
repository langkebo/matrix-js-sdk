import { EventType } from "./@types/event.ts";
import { type Room } from "./models/room.ts";

type RoomLookup = (roomId: string | undefined) => Room | null;

function getReplacementRoomId(room: Room): string | undefined {
    const tombstoneEvent = room.currentState.getStateEvents(EventType.RoomTombstone, "");
    if (!tombstoneEvent) return undefined;

    const content = tombstoneEvent.getContent() as { replacement_room?: unknown };
    return typeof content.replacement_room === "string" ? content.replacement_room : undefined;
}

export function findPredecessorRoomsForUpgrade(
    startRoom: Room,
    getRoom: RoomLookup,
    verifyLinks: boolean,
    msc3946ProcessDynamicPredecessor: boolean,
): Room[] {
    const ret: Room[] = [];
    const seenRoomIDs = new Set<string>([startRoom.roomId]);

    // Work backwards from newer to older rooms
    let current = startRoom;
    let predecessorRoomId = current.findPredecessor(msc3946ProcessDynamicPredecessor)?.roomId;
    while (predecessorRoomId != null) {
        if (predecessorRoomId) {
            if (seenRoomIDs.has(predecessorRoomId)) break;
            seenRoomIDs.add(predecessorRoomId);
        }
        const predecessorRoom = getRoom(predecessorRoomId);
        if (predecessorRoom === null) {
            break;
        }
        if (verifyLinks) {
            const replacementRoomId = getReplacementRoomId(predecessorRoom);
            if (!replacementRoomId || replacementRoomId !== current.roomId) {
                break;
            }
        }

        // Insert at the front because we're working backwards from the current room
        ret.unshift(predecessorRoom);
        current = predecessorRoom;
        predecessorRoomId = current.findPredecessor(msc3946ProcessDynamicPredecessor)?.roomId;
    }

    return ret;
}

export function findSuccessorRoomsForUpgrade(
    startRoom: Room,
    getRoom: RoomLookup,
    verifyLinks: boolean,
    msc3946ProcessDynamicPredecessor: boolean,
): Room[] {
    const ret: Room[] = [];
    const seenRoomIDs = new Set<string>([startRoom.roomId]);

    // Work forwards, looking at tombstone events
    let current = startRoom;
    let successorRoomId = getReplacementRoomId(current);
    while (successorRoomId) {
        const successorRoom = getRoom(successorRoomId);
        if (!successorRoom) break; // end of the chain
        if (seenRoomIDs.has(successorRoom.roomId)) break; // avoid loops

        if (verifyLinks) {
            const predecessorRoomId = successorRoom.findPredecessor(msc3946ProcessDynamicPredecessor)?.roomId;
            if (!predecessorRoomId || predecessorRoomId !== current.roomId) {
                break;
            }
        }

        ret.push(successorRoom);
        seenRoomIDs.add(successorRoom.roomId);
        current = successorRoom;
        successorRoomId = getReplacementRoomId(current);
    }

    return ret;
}

export function buildRoomUpgradeHistory(
    roomId: string,
    getRoom: RoomLookup,
    verifyLinks: boolean,
    msc3946ProcessDynamicPredecessor: boolean,
): Room[] {
    const currentRoom = getRoom(roomId);
    if (!currentRoom) return [];

    const before = findPredecessorRoomsForUpgrade(currentRoom, getRoom, verifyLinks, msc3946ProcessDynamicPredecessor);
    const after = findSuccessorRoomsForUpgrade(currentRoom, getRoom, verifyLinks, msc3946ProcessDynamicPredecessor);

    return [...before, currentRoom, ...after];
}

export function selectVisibleRoomsForClient(
    allRooms: Room[],
    getRoom: RoomLookup,
    msc3946ProcessDynamicPredecessor: boolean,
): Room[] {
    const visibleRooms = new Set(allRooms);
    for (const room of visibleRooms) {
        const predecessors = findPredecessorRoomsForUpgrade(room, getRoom, true, msc3946ProcessDynamicPredecessor);
        for (const predecessor of predecessors) {
            visibleRooms.delete(predecessor);
        }
    }
    return Array.from(visibleRooms);
}
