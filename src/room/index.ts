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

import { MatrixClient } from "../client.ts";
import { RoomManager } from "./RoomManager.ts";

export * from "./RoomManager.ts";

declare module "../client.ts" {
    interface MatrixClient {
        getRoomManager(): RoomManager;
    }
}

/**
 * 为 MatrixClient 扩展 RoomManager 相关能力
 */
export function extendMatrixClient(): void {
    if (MatrixClient.prototype.hasOwnProperty("getRoomManager")) return;

    MatrixClient.prototype.getRoomManager = function (this: MatrixClient): RoomManager {
        return new RoomManager(this);
    };
}

export default extendMatrixClient;
