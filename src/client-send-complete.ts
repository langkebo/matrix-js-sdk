/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { EventStatus } from "./models/event";
import { type IEvent, MatrixEvent, MatrixEventEvent } from "./models/event";
import type { QueryDict } from "./utils";
import type { Room } from "./models/room";

interface ReEmitterLike {
    reEmit(target: MatrixEvent, events: MatrixEventEvent[]): void;
}

export function ensureTxnId(txnId: string | undefined, makeTxnId: () => string): string {
    return txnId ?? makeTxnId();
}

export function createLocalEchoEvent(
    eventObject: Partial<IEvent>,
    roomId: string,
    userId: string,
    txnId: string,
): MatrixEvent {
    return new MatrixEvent(
        Object.assign(eventObject, {
            event_id: `~${roomId}:${txnId}`,
            user_id: userId,
            sender: userId,
            room_id: roomId,
            origin_server_ts: Date.now(),
        }),
    );
}

export function attachThreadToLocalEvent(localEvent: MatrixEvent, room: Room | null, threadId: string | null): void {
    if (!threadId || !room) return;
    const thread = room.getThread(threadId);
    if (thread) {
        localEvent.setThread(thread);
    }
}

export function setupLocalEventReemit(localEvent: MatrixEvent, room: Room | null, reEmitter: ReEmitterLike): void {
    reEmitter.reEmit(localEvent, [MatrixEventEvent.Replaced, MatrixEventEvent.VisibilityChange]);
    room?.reEmitter.reEmit(localEvent, [MatrixEventEvent.BeforeRedaction]);
}

export function bindPendingRelationTarget(localEvent: MatrixEvent, room: Room | null): void {
    const targetId = localEvent.getAssociatedId();
    if (!targetId?.startsWith("~")) return;

    const target = room?.getPendingEvents().find((e) => e.getId() === targetId);
    target?.once(MatrixEventEvent.LocalEventIdReplaced, () => {
        localEvent.updateAssociatedId(target.getId()!);
    });
}

export function formatSendEventDebugMessage(
    type: string,
    roomId: string,
    txnId: string,
    isDelayed: boolean,
    queryDict?: QueryDict,
): string {
    return `sendEvent of type ${type} in ${roomId} with txnId ${txnId}${isDelayed ? " (delayed event)" : ""}${queryDict ? ` query params: ${JSON.stringify(queryDict)}` : ""}`;
}

export function addPendingEventOrThrow(room: Room | null, localEvent: MatrixEvent, txnId: string): void {
    room?.addPendingEvent(localEvent, txnId);
    if (localEvent.status === EventStatus.NOT_SENT) {
        throw new Error("Event blocked by other events not yet sent");
    }
}
