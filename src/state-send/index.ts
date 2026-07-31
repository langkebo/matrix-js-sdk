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

/**
 * State Send Manager - 状态发送管理
 *
 * 提供状态事件发送相关功能，包括权限级别设置等
 */

import { MatrixClient } from "../client";
import { EventType } from "../@types/event";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { MatrixError } from "../http-api/errors";
import { NotFoundError } from "../errors";
import type { IPowerLevelsContent } from "../models/room-state";
import type { ISendEventResponse } from "../@types/requests";
import type { IContent } from "../models/event";
import * as utils from "../utils";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface StateSendManagerEvents {
    stateEventSent: (data: { roomId: string; eventType: string; stateKey: string }) => void;
    powerLevelsChanged: (data: { roomId: string; userIds: string[]; powerLevel: number | undefined }) => void;
}

type ClientInternals = {
    clientRunning: boolean;
    isInitialSyncComplete(): boolean;
    getRoom(
        roomId: string,
    ): { currentState?: { getStateEvents(type: string, key: string): { getContent(): IContent } } } | null;
    getStateEvent(roomId: string, eventType: string, stateKey: string): Promise<IContent>;
    sendStateEvent<K extends string>(
        roomId: string,
        eventType: K,
        content: IContent,
        stateKey: string,
    ): Promise<ISendEventResponse>;
};

export class StateSendManager extends BaseManager<keyof StateSendManagerEvents, StateSendManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public async setPowerLevel(
        roomId: string,
        userId: string | string[],
        powerLevel: number | undefined,
    ): Promise<ISendEventResponse> {
        const clientInternals = this.internalClient as unknown as ClientInternals;

        let content: IPowerLevelsContent | undefined;
        if (clientInternals.clientRunning && clientInternals.isInitialSyncComplete()) {
            content = clientInternals
                .getRoom(roomId)
                ?.currentState?.getStateEvents(EventType.RoomPowerLevels, "")
                ?.getContent() as IPowerLevelsContent | undefined;
        }
        if (!content) {
            try {
                content = (await clientInternals.getStateEvent(
                    roomId,
                    EventType.RoomPowerLevels,
                    "",
                )) as IPowerLevelsContent;
            } catch (e: unknown) {
                const notFound =
                    e instanceof NotFoundError ||
                    (e instanceof MatrixError && e.errcode === "M_NOT_FOUND") ||
                    (e as { errorCode?: string; statusCode?: number })?.errorCode === "M_NOT_FOUND" ||
                    (e as { statusCode?: number })?.statusCode === 404;
                if (notFound) {
                    content = {};
                } else {
                    throw e;
                }
            }
        }

        content = utils.deepCopy(content);

        if (!content?.users) {
            content.users = {};
        }
        const users = Array.isArray(userId) ? userId : [userId];
        for (const user of users) {
            if (powerLevel == null) {
                delete content.users[user];
            } else {
                content.users[user] = powerLevel;
            }
        }

        const result = await clientInternals.sendStateEvent(roomId, EventType.RoomPowerLevels, content, "");
        this.emit("powerLevelsChanged", { roomId, userIds: users, powerLevel });
        return result;
    }
}

export function extendMatrixClient(): void {
    if (MatrixClient.prototype.hasOwnProperty("getStateSendManager")) return;

    MatrixClient.prototype.getStateSendManager = function (this: MatrixClient): StateSendManager {
        registerManagerClass("stateSend", StateSendManager);
        return getOrCreateManager(this, "stateSend", () => new StateSendManager(this));
    };
}
