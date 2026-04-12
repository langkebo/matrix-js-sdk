import type { SyncApi } from "./sync.ts";
import type { Room } from "./models/room.ts";

export function beginRoomPeek(
    roomId: string,
    limit: number,
    currentPeekSync: SyncApi | null,
    createPeekSync: () => SyncApi,
): { nextPeekSync: SyncApi; peekPromise: Promise<Room> } {
    currentPeekSync?.stopPeeking();
    const nextPeekSync = createPeekSync();
    return {
        nextPeekSync,
        peekPromise: nextPeekSync.peek(roomId, limit),
    };
}

export function endRoomPeek(currentPeekSync: SyncApi | null): SyncApi | null {
    if (currentPeekSync) {
        currentPeekSync.stopPeeking();
    }
    return null;
}
