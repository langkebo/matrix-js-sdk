/*
Copyright 2026 The Matrix.org Foundation C.I.C.

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

import { z } from "zod";

import type { MatrixClient } from "../client.ts";
import type { IContent, IEvent, IMentions, IUnsigned, MatrixEvent } from "../models/event.ts";
import type { Room } from "../models/room.ts";

const mentionsSchema: z.ZodType<IMentions> = z
    .object({
        user_ids: z.array(z.string()).optional(),
        room: z.boolean().optional(),
    })
    .catchall(z.unknown());

export const matrixEventContentSchema: z.ZodType<IContent> = z
    .object({
        msgtype: z.string().optional(),
        membership: z.string().optional(),
        avatar_url: z.string().optional(),
        displayname: z.string().optional(),
        body: z.string().optional(),
        url: z.string().optional(),
        info: z.unknown().optional(),
        "m.relates_to": z.record(z.string(), z.unknown()).optional(),
        "m.mentions": mentionsSchema.optional(),
    })
    .catchall(z.unknown());

const strippedStateSchema = z.object({
    content: matrixEventContentSchema,
    state_key: z.string(),
    type: z.string(),
    sender: z.string(),
});

export const matrixUnsignedSchema: z.ZodType<IUnsigned> = z
    .object({
        age: z.number().optional(),
        prev_sender: z.string().optional(),
        prev_content: matrixEventContentSchema.optional(),
        redacted_because: z.lazy(() => matrixEventWireSchema).optional(),
        replaces_state: z.string().optional(),
        transaction_id: z.string().optional(),
        invite_room_state: z.array(strippedStateSchema).optional(),
        "m.relations": z.record(z.string(), z.unknown()).optional(),
        msc4354_sticky_duration_ttl_ms: z.number().optional(),
        membership: z.string().optional(),
        "io.element.msc4115.membership": z.string().optional(),
    })
    .catchall(z.unknown());

export const matrixEventWireSchema: z.ZodType<IEvent> = z.lazy(() =>
    z.object({
        event_id: z.string(),
        type: z.string(),
        content: matrixEventContentSchema,
        sender: z.string(),
        room_id: z.string().optional(),
        origin_server_ts: z.number(),
        txn_id: z.string().optional(),
        state_key: z.string().optional(),
        membership: z.string().optional(),
        unsigned: matrixUnsignedSchema,
        redacts: z.string().optional(),
        msc4354_sticky: z
            .object({
                duration_ms: z.number(),
            })
            .optional(),
    }),
);

export type MatrixEventWire = z.infer<typeof matrixEventWireSchema>;

export const matrixEventSnapshotSchema = z.object({
    eventId: z.string().nullable(),
    roomId: z.string().nullable(),
    type: z.string(),
    sender: z.string().nullable(),
    ts: z.number(),
    stateKey: z.string().nullable(),
    content: matrixEventContentSchema,
    unsigned: matrixUnsignedSchema,
});

export type MatrixEventSnapshot = z.infer<typeof matrixEventSnapshotSchema>;

export const roomSnapshotSchema = z.object({
    roomId: z.string(),
    name: z.string(),
    normalizedName: z.string(),
    myMembership: z.string(),
    roomType: z.string().optional(),
    pendingEventCount: z.number().int().nonnegative(),
    tags: z.record(z.string(), z.record(z.string(), z.unknown())),
});

export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;

export const matrixClientSnapshotSchema = z.object({
    baseUrl: z.string().min(1),
    clientRunning: z.boolean(),
    userId: z.string().nullable(),
    deviceId: z.string().nullable(),
    supportsVoip: z.boolean(),
});

export type MatrixClientSnapshot = z.infer<typeof matrixClientSnapshotSchema>;

export function parseMatrixEventWire(event: unknown): MatrixEventWire {
    return matrixEventWireSchema.parse(event);
}

export function createMatrixEventSnapshot(
    event: Pick<MatrixEvent, "getId" | "getRoomId" | "getType" | "getSender" | "getTs" | "getStateKey" | "getContent" | "getUnsigned">,
): MatrixEventSnapshot {
    return matrixEventSnapshotSchema.parse({
        eventId: event.getId(),
        roomId: event.getRoomId(),
        type: event.getType(),
        sender: event.getSender(),
        ts: event.getTs(),
        stateKey: event.getStateKey() ?? null,
        content: event.getContent<IContent>(),
        unsigned: event.getUnsigned(),
    });
}

export function createRoomSnapshot(
    room: Pick<Room, "roomId" | "name" | "normalizedName" | "tags" | "getMyMembership" | "getType" | "getPendingEvents">,
): RoomSnapshot {
    return roomSnapshotSchema.parse({
        roomId: room.roomId,
        name: room.name,
        normalizedName: room.normalizedName,
        myMembership: room.getMyMembership(),
        roomType: room.getType(),
        pendingEventCount: room.getPendingEvents().length,
        tags: room.tags,
    });
}

export function createMatrixClientSnapshot(
    client: Pick<MatrixClient, "baseUrl" | "clientRunning" | "getUserId" | "getDeviceId" | "supportsVoip">,
): MatrixClientSnapshot {
    return matrixClientSnapshotSchema.parse({
        baseUrl: client.baseUrl,
        clientRunning: client.clientRunning,
        userId: client.getUserId(),
        deviceId: client.getDeviceId(),
        supportsVoip: client.supportsVoip(),
    });
}
