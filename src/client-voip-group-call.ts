/*
Copyright 2024 The Matrix.org Foundation C.I.C.

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

import { GroupCall } from "./web-rtc/groupCall";

import type { MatrixClient } from "./client";
import type { GroupCallType, GroupCallIntent, IGroupCallDataChannelOptions } from "./web-rtc/groupCall";

/**
 * Create a new group call for the given room.
 * Extracted from createGroupCall to keep client.ts thin.
 */
export async function createGroupCallForRoom(
    client: MatrixClient,
    roomId: string,
    type: GroupCallType,
    isPtt: boolean,
    intent: GroupCallIntent,
    dataChannelsEnabled?: boolean,
    dataChannelOptions?: IGroupCallDataChannelOptions,
): Promise<GroupCall> {
    if (client.getGroupCallForRoom(roomId)) {
        throw new Error(`${roomId} already has an existing group call`);
    }

    const room = client.getRoom(roomId);

    if (!room) {
        throw new Error(`Cannot find room ${roomId}`);
    }

    // Because without Media section a WebRTC connection is not possible, so need a RTCDataChannel to set up a
    // no media WebRTC connection anyway.
    return new GroupCall(
        client,
        room,
        type,
        isPtt,
        intent,
        undefined,
        dataChannelsEnabled || client.isVoipWithNoMediaAllowed,
        dataChannelOptions,
        client.isVoipWithNoMediaAllowed,
        client.useLivekitForGroupCalls,
        client.livekitServiceURL,
    ).create();
}
