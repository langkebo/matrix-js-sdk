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

import { User } from "./models/user";
import { SlidingSyncSdk } from "./sliding-sync-sdk";
import { SyncApi, type SyncApiOptions } from "./sync";
import { Thread } from "./models/thread";

import type { MatrixClient } from "./client";
import type { IStartClientOpts } from "./client-config-types";

export const TURN_CHECK_INTERVAL = 10 * 60 * 1000; // poll for turn credentials every 10 minutes

/**
 * Detect server capabilities and configure thread support.
 * Extracted from startClient to keep client.ts thin.
 */
export async function detectServerCapabilities(client: MatrixClient): Promise<void> {
    try {
        await client.getVersions();

        const { threads, list, fwdPagination } = await client.doesServerSupportThread();
        Thread.setServerSideSupport(threads);
        Thread.setServerSideListSupport(list);
        Thread.setServerSideFwdPaginationSupport(fwdPagination);
    } catch (e) {
        client.logger.error(
            "Can't fetch server versions, continuing to initialise sync, this will be retried later",
            e,
        );
    }
}

/**
 * Build sync API options for this client, suitable for passing into the SyncApi constructor.
 */
export function buildSyncApiOptions(client: MatrixClient): SyncApiOptions {
    return {
        cryptoCallbacks: client.cryptoBackend,
        canResetEntireTimeline: (roomId: string): boolean => {
            if (!client.canResetTimelineCallback) {
                return false;
            }
            return client.canResetTimelineCallback(roomId);
        },
        logger: client.logger.getChild("sync"),
    };
}

/**
 * Start all client lifecycle services (TURN polling, sync, well-known, queues).
 * Extracted from startClient to keep client.ts thin.
 */
export async function startClientLifecycleServices(
    client: MatrixClient,
    opts: IStartClientOpts,
): Promise<void> {
    // Create our own user object artificially (instead of waiting for sync)
    const userId = client.getUserId();
    if (userId) {
        client.store.storeUser(new User(userId));
    }

    // periodically poll for turn servers if we support voip
    if (client.supportsVoip()) {
        client.checkTurnServersIntervalID = setInterval(() => {
            client.checkTurnServers();
        }, TURN_CHECK_INTERVAL);
        // noinspection ES6MissingAwait
        client.checkTurnServers();
    }

    if (client.syncApi) {
        client.logger.error("Still have sync object whilst not running: stopping old one");
        client.syncApi.stop();
    }

    await detectServerCapabilities(client);

    const syncOpts = buildSyncApiOptions(client);

    if (opts.slidingSync) {
        client.syncApi = new SlidingSyncSdk(opts.slidingSync, client, opts, syncOpts);
    } else {
        client.syncApi = new SyncApi(client, opts, syncOpts);
    }

    client.syncApi.sync().catch((e) => client.logger.info("Sync startup aborted with an error:", e));

    if (opts.clientWellKnownPollPeriod !== undefined) {
        client.clientWellKnownIntervalID = setInterval(() => {
            client.fetchClientWellKnown();
        }, 1000 * opts.clientWellKnownPollPeriod);
        client.fetchClientWellKnown();
    }

    client.toDeviceMessageQueue.start();
    client.serverCapabilitiesService.start();
}
