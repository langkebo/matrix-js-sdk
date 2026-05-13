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
 * Power Levels Manager - 权限级别管理
 *
 * 提供权限级别相关功能
 */

import { MatrixClient } from "../client";
import { MatrixEvent } from "../models/event";
import { Room } from "../models/room";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface IPowerLevelContent {
    users_default?: number;
    events_default?: number;
    state_default?: number;
    ban?: number;
    kick?: number;
    redact?: number;
    invite?: number;
    users?: Record<string, number>;
    events?: Record<string, number>;
    notifications?: {
        room?: number;
    };
}

export interface PowerLevelsManagerEvents {
    power_level_changed: { roomId: string; userId: string; level: number };
    permissions_updated: { roomId: string };
}

export class PowerLevelsManager extends BaseManager<keyof PowerLevelsManagerEvents, PowerLevelsManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public getUserPowerLevel(userId: string, roomId: string): number {
        return (
            this.client as unknown as {
                getUserPowerLevel: (userId: string, roomId: string) => number;
            }
        ).getUserPowerLevel(userId, roomId);
    }

    public getPowerLevelEventContent(roomId: string): IPowerLevelContent | null {
        return (
            this.client as unknown as {
                getPowerLevelEventContent: (roomId: string) => IPowerLevelContent | null;
            }
        ).getPowerLevelEventContent(roomId);
    }

    public async setUserPowerLevel(userId: string, roomId: string, powerLevel: number): Promise<void> {
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        setUserPowerLevel: (userId: string, roomId: string, powerLevel: number) => Promise<void>;
                    }
                ).setUserPowerLevel(userId, roomId, powerLevel),
            "setUserPowerLevel",
        );
    }

    public canSendEvent(eventType: string, roomId: string): boolean {
        return (
            this.client as unknown as {
                canSendEvent: (eventType: string, roomId: string) => boolean;
            }
        ).canSendEvent(eventType, roomId);
    }

    public checkAuthEvent(event: MatrixEvent, room: Room): boolean {
        return (
            this.client as unknown as {
                checkAuthEvent: (event: MatrixEvent, room: Room) => boolean;
            }
        ).checkAuthEvent(event, room);
    }

    public isRoomAdmin(roomId: string): boolean {
        return (
            this.client as unknown as {
                isRoomAdmin: (roomId: string) => boolean;
            }
        ).isRoomAdmin(roomId);
    }

    public isRoomModerator(roomId: string): boolean {
        return (
            this.client as unknown as {
                isRoomModerator: (roomId: string) => boolean;
            }
        ).isRoomModerator(roomId);
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getPowerLevelsManager(): PowerLevelsManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getPowerLevelsManager = function (): PowerLevelsManager {
        return getOrCreateManager(this, "powerLevels", () => new PowerLevelsManager(this));
    };
}

export default extendMatrixClient;
