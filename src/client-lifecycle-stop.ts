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

import type { MatrixClient } from "./client";

/**
 * Stop all client lifecycle services (crypto, sync, VOIP, queues).
 * Extracted from stopClient to keep client.ts thin.
 */
export function stopClientLifecycleServices(client: MatrixClient): void {
    client.cryptoBackend?.stop();

    client.syncApi?.stop();
    client.syncApi = undefined;

    client.peekSync?.stopPeeking();

    client.callEventHandler?.stop();
    client.groupCallEventHandler?.stop();
    client.callEventHandler = undefined;
    client.groupCallEventHandler = undefined;

    globalThis.clearInterval(client.checkTurnServersIntervalID);
    client.checkTurnServersIntervalID = undefined;

    if (client.clientWellKnownIntervalID !== undefined) {
        globalThis.clearInterval(client.clientWellKnownIntervalID);
    }

    client.toDeviceMessageQueue.stop();
    client.matrixRTC.stop();
    client.serverCapabilitiesService.stop();
}
