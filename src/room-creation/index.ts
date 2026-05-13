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
 * Room Creation Manager - 房间创建管理
 *
 * 提供房间创建相关功能
 */

import { MatrixClient } from "../client";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface ICreateRoomOptions {
    room_alias_name?: string;
    visibility?: "public" | "private";
    invite?: string[];
    invite_3pid?: Array<{
        id_server: string;
        id_access_token: string;
        medium: string;
        address: string;
    }>;
    room_version?: string;
    creation_content?: Record<string, unknown>;
    initial_state?: Array<{
        type: string;
        state_key?: string;
        content: Record<string, unknown>;
    }>;
    preset?: "private_chat" | "public_chat" | "trusted_private_chat";
    is_direct?: boolean;
    name?: string;
    topic?: string;
    power_level_content_override?: Record<string, unknown>;
}

export interface ICreateRoomResponse {
    room_id: string;
}

export interface ICreateRoomOptionsConfig extends ICreateRoomOptions {
    [key: string]: unknown;
}

export interface RoomCreationManagerEvents {
    room_created: { roomId: string };
    room_creation_failed: { error: Error };
    direct_room_created: { roomId: string; userId: string };
}

export class RoomCreationManager extends BaseManager<keyof RoomCreationManagerEvents, RoomCreationManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async createRoom(options?: ICreateRoomOptions): Promise<ICreateRoomResponse> {
        return this.withRetry(() => this.client.createRoom(options as Record<string, unknown>), "createRoom");
    }

    public async createDirectRoom(userId: string, options?: ICreateRoomOptions): Promise<ICreateRoomResponse> {
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        createDirectRoom: (
                            userId: string,
                            options?: ICreateRoomOptions,
                        ) => Promise<ICreateRoomResponse>;
                    }
                ).createDirectRoom(userId, options),
            "createDirectRoom",
        );
    }

    public async findOrCreateDirectRoom(userId: string): Promise<ICreateRoomResponse> {
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        findOrCreateDirectRoom: (userId: string) => Promise<ICreateRoomResponse>;
                    }
                ).findOrCreateDirectRoom(userId),
            "findOrCreateDirectRoom",
        );
    }

    public getCreateRoomOptions(): ICreateRoomOptionsConfig {
        return (
            this.client as unknown as {
                getCreateRoomOptions: () => ICreateRoomOptionsConfig;
            }
        ).getCreateRoomOptions();
    }

    public setCreateRoomOptions(options: ICreateRoomOptionsConfig): void {
        (
            this.client as unknown as {
                setCreateRoomOptions: (options: ICreateRoomOptionsConfig) => void;
            }
        ).setCreateRoomOptions(options);
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getRoomCreationManager(): RoomCreationManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomCreationManager = function (): RoomCreationManager {
        return getOrCreateManager(this, "roomCreation", () => new RoomCreationManager(this));
    };
}

export default extendMatrixClient;
