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

import { MatrixClient } from "../client";
import { EventManager } from "./EventManager";
import type { RetryOptions } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export * from "./EventManager";

export function extendMatrixClient(): void {
    registerManagerClass("event", EventManager);

    if (MatrixClient.prototype.hasOwnProperty("getEventManager")) return;

    MatrixClient.prototype.getEventManager = function (this: MatrixClient): EventManager {
        return getOrCreateManager(this, "event", () => new EventManager(this));
    };
}

export function setEventManagerRetryOptions(client: MatrixClient, options: RetryOptions): void {
    const manager = client.getEventManager();
    manager.setRetryOptions(options);
}
