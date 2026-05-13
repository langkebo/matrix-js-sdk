/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You May obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * Group Call Manager - 群组通话管理
 *
 * 提供群组通话相关功能
 */

import { MatrixClient } from "../client";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface IGroupCallOptions {
    isPtt?: boolean;
    intent?: string;
    dataChannelOptions?: Record<string, unknown>;
}

export interface IGroupCall {
    roomId: string;
    isActive: boolean;
    participants: Array<{
        userId: string;
        deviceId: string;
    }>;
}

export class GroupCallManager extends BaseManager {
    constructor(client: MatrixClient) {
        super(client);
    }

    public getGroupCallForRoom(roomId: string): IGroupCall | null {
        return (
            this.client as unknown as {
                getGroupCallForRoom: (roomId: string) => IGroupCall | null;
            }
        ).getGroupCallForRoom(roomId);
    }

    public async createGroupCall(roomId: string, options?: IGroupCallOptions): Promise<IGroupCall> {
        return (
            this.client as unknown as {
                createGroupCall: (roomId: string, options?: IGroupCallOptions) => Promise<IGroupCall>;
            }
        ).createGroupCall(roomId, options);
    }

    public getUseE2eForGroupCall(): boolean {
        return (
            this.client as unknown as {
                getUseE2eForGroupCall: () => boolean;
            }
        ).getUseE2eForGroupCall();
    }

    public async waitUntilRoomReadyForGroupCalls(roomId: string): Promise<void> {
        return (
            this.client as unknown as {
                waitUntilRoomReadyForGroupCalls: (roomId: string) => Promise<void>;
            }
        ).waitUntilRoomReadyForGroupCalls(roomId);
    }

    public getActiveGroupCalls(): IGroupCall[] {
        return (
            this.client as unknown as {
                getActiveGroupCalls: () => IGroupCall[];
            }
        ).getActiveGroupCalls();
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getGroupCallManager(): GroupCallManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getGroupCallManager = function (): GroupCallManager {
        return getOrCreateManager(this, "groupManagement", () => new GroupCallManager(this));
    };
}

export default extendMatrixClient;
