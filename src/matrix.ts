/*
Copyright 2015-2022 The Matrix.org Foundation C.I.C.

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

import { type WidgetApi } from "matrix-widget-api";

import { extendMatrixClient as extendAccount } from "./account";
import { extendMatrixClient as extendAccountData } from "./account-data";
import { extendMatrixClient as extendAuth } from "./auth";

import { MemoryCryptoStore } from "./crypto/store/memory-crypto-store";
import { extendMatrixClient as extendDevice } from "./device";
import { extendMatrixClient as extendIdentityServer } from "./identity-server";
import { extendMatrixClient as extendPresence } from "./presence";
import { extendMatrixClient as extendProfile } from "./profile";
import { MemoryStore } from "./store/memory";
import { MatrixScheduler } from "./scheduler";
import { MatrixClient, type ICreateClientOpts } from "./client";
import { RoomWidgetClient, type ICapabilities } from "./embedded";
import { type CryptoStore } from "./crypto/store/base";
import { extendMatrixClientWithManagers, isManagerExtensionsInitialized } from "./manager-extensions";
import { extendMatrixClient as extendRoom } from "./room";
import { extendMatrixClient as extendEvent } from "./event";

export {
    extendMatrixClientWithManagers,
    isManagerExtensionsInitialized,
    offManagerExtensionsLifecycle,
    onManagerExtensionsLifecycle,
    resetManagerExtensions,
} from "./manager-extensions";

export type {
    ManagerExtensionsLifecycleEvent,
    ManagerExtensionsLifecycleListener,
    ManagerExtensionsLifecyclePhase,
    ManagerExtensionsLifecycleStatus,
    ManagerExtensionsOptions,
} from "./manager-extensions";

export * from "./client";
export * from "./serverCapabilities";
export * from "./embedded";
export * from "./http-api/index";
export * from "./autodiscovery";
export * from "./sync-accumulator";
export * from "./errors";
export * from "./base64";
export * from "./models/event";
export * from "./models/room";
export * from "./models/event-timeline";
export * from "./models/event-timeline-set";
export * from "./models/room-member";
export * from "./models/room-state";
export * from "./models/thread";
export * from "./models/typed-event-emitter";
export * from "./models/user";
export * from "./models/device";
export * from "./models/search-result";
export * from "./oidc/index";
export * from "./scheduler";
export * from "./filter";
export * from "./timeline-window";
export * from "./interactive-auth";
export * from "./version-support";
export * from "./service-types";
export * from "./store/memory";
export * from "./store/indexeddb";
export * from "./crypto/store/memory-crypto-store";
export * from "./crypto/store/localStorage-crypto-store";
export * from "./crypto/store/indexeddb-crypto-store";
export type { OutgoingRoomKeyRequest } from "./crypto/store/base";
export * from "./content-repo";
export type * from "./@types/common";
export type * from "./@types/uia";
export * from "./@types/event";
export * from "./@types/PushRules";
export * from "./@types/partials";
export * from "./@types/requests";
export * from "./@types/search";
export * from "./@types/topic";
export * from "./@types/three-pids";
export * from "./@types/auth";
export type * from "./@types/local_notifications";
export type * from "./@types/registration";
export * from "./@types/read_receipts";
export type * from "./@types/crypto";
export type * from "./@types/IIdentityServerProvider";
export * from "./@types/membership";
export * from "./@types/beacon";
export * from "./@types/location";
export * from "./models/room-summary";
export * from "./models/event-status";
export * from "./models/profile-keys";
export * from "./models/related-relations";
export * from "./runtime-schemas/index";
export type { RoomSummary } from "./client";
export * from "./matrix-managers";

export type { ICreateClientOpts } from "./client";
export { PendingEventOrdering } from "./client";
export type { LoginResponse } from "./@types/auth";
export type { IEventRelation } from "./models/event";
export { EventTimeline } from "./models/event-timeline";
export { TimelineWindow } from "./timeline-window";
export { ReceiptType } from "./@types/read_receipts";
export * as ContentHelpers from "./content-helpers";
export * as SecretStorage from "./secret-storage";
export { createNewMatrixCall, CallEvent } from "./web-rtc/call";
export type { MatrixCall } from "./web-rtc/call";
export {
    GroupCall,
    GroupCallEvent,
    GroupCallIntent,
    GroupCallState,
    GroupCallType,
    GroupCallStatsReportEvent,
} from "./web-rtc/groupCall";

export { SyncState, SetPresence } from "./sync";
export type { ISyncStateData as SyncStateData } from "./sync";
// Re-export with alias for frontend compatibility
export type { ISearchResponse as SearchResponse } from "./@types/search";
// Re-export device management types not covered by models/device
export type { IDeviceUpdateRequest, IDeviceDeleteRequest } from "./device";
export { SlidingSyncEvent, SlidingSyncState, SlidingSync } from "./sliding-sync";
export type {
    MSC3575SlidingSyncResponse,
    MSC3575RoomData,
    MSC3575List,
    MSC3575RoomSubscription,
    MSC3575Filter,
} from "./sliding-sync";
export { SlidingSyncSdk } from "./sliding-sync-sdk";
export { MediaHandlerEvent } from "./web-rtc/mediaHandler";
export { CallFeedEvent } from "./web-rtc/callFeed";
export { StatsReport } from "./web-rtc/stats/statsReport";
export { Relations, RelationsEvent } from "./models/relations";
export { TypedEventEmitter } from "./models/typed-event-emitter";
export { LocalStorageErrors, localStorageErrorsEventsEmitter } from "./store/local-storage-events-emitter";
export { IdentityProviderBrand, SSOAction } from "./@types/auth";
export type { ISSOFlow as SSOFlow, LoginFlow } from "./@types/auth";
export type { IHierarchyRelation as HierarchyRelation, IHierarchyRoom as HierarchyRoom } from "./@types/spaces";
export { DebugLogger } from "./logger";
export { TelemetryManager } from "./telemetry/index";

// Re-export crypto key backup types for frontend usage (list C.2)
export type { KeyBackupInfo, KeyBackupSession, KeyBackupRoomSessions } from "./crypto-api/keybackup";
// Re-export MatrixClientExtensionMethods for frontend type augmentation (list C.3)
export type { MatrixClientExtensionMethods } from "./matrix-client-extensions";

let cryptoStoreFactory = (): CryptoStore => new MemoryCryptoStore();

/**
 * Configure a different factory to be used for creating crypto stores
 *
 * @param fac - a function which will return a new `CryptoStore`
 */
export function setCryptoStoreFactory(fac: () => CryptoStore): void {
    cryptoStoreFactory = fac;
}

function amendClientOpts(opts: ICreateClientOpts): ICreateClientOpts {
    opts.store =
        opts.store ??
        new MemoryStore({
            localStorage: globalThis.localStorage,
        });
    opts.scheduler = opts.scheduler ?? new MatrixScheduler();
    opts.cryptoStore = opts.cryptoStore ?? cryptoStoreFactory();

    return opts;
}

function installSynchronousCoreManagerExtensions(): void {
    extendRoom();
    extendEvent();
    extendAccount();
    extendAccountData();
    extendAuth();
    extendDevice();
    extendIdentityServer();
    extendPresence();
    extendProfile();
}

function shouldSkipAsyncManagerInit(): boolean {
    return typeof process !== "undefined" && Boolean(process.env?.VITEST);
}

/** Track whether the Vitest environment is being torn down */
let isTearingDown = false;
if (typeof process !== "undefined" && process.env?.VITEST) {
    const origExit = process.exit?.bind(process);
    if (typeof origExit === "function") {
        process.exit = ((code?: number) => {
            isTearingDown = true;
            origExit(code);
        }) as typeof process.exit;
    }
}

function isEnvironmentTornDown(): boolean {
    return isTearingDown;
}

async function autoInitManagerExtensions(opts: ICreateClientOpts): Promise<void> {
    if (opts.disableDynamicExtensions) {
        return;
    }

    if (isManagerExtensionsInitialized()) {
        return;
    }

    if (shouldSkipAsyncManagerInit()) {
        return;
    }

    try {
        await initializeManagerExtensions();
    } catch (error) {
        // Silently swallow teardown-related import errors to avoid
        // EnvironmentTeardownError when dynamic imports resolve after
        // the Vitest environment has been torn down.
        if (isEnvironmentTornDown() || (error instanceof Error && error.name === "EnvironmentTeardownError")) {
            return;
        }
        throw error;
    }
}

export async function initializeManagerExtensions(): Promise<void> {
    await extendMatrixClientWithManagers();
}

/**
 * Construct a Matrix Client. Similar to {@link MatrixClient}
 * except that the 'request', 'store' and 'scheduler' dependencies are satisfied.
 * @param opts - The configuration options for this client. These configuration
 * options will be passed directly to {@link MatrixClient}.
 *
 * @returns A new matrix client.
 * @see {@link MatrixClient} for the full list of options for
 * `opts`.
 */
export function createClient(opts: ICreateClientOpts): MatrixClient {
    installSynchronousCoreManagerExtensions();
    void autoInitManagerExtensions(opts);
    return new MatrixClient(amendClientOpts(opts));
}

/**
 * Construct a Matrix Client that works in a widget.
 * This client has a subset of features compared to a full client.
 * It uses the widget-api to communicate with matrix. (widget \<-\> client \<-\> homeserver)
 * @returns A new matrix client with a subset of features.
 * @param opts - The configuration options for this client. These configuration
 * options will be passed directly to {@link MatrixClient}.
 * @param widgetApi - The widget api to use for communication.
 * @param capabilities - The capabilities the widget client will request.
 * @param roomId - The room id the widget is associated with.
 * @param sendContentLoaded - Whether to send a content loaded widget action immediately after initial setup.
 *   Set to `false` if the widget uses `waitForIFrameLoad=true` (in this case the client does not expect a content loaded action at all),
 *   or if the the widget wants to send the `ContentLoaded` action at a later point in time after the initial setup.
 */
export function createRoomWidgetClient(
    widgetApi: WidgetApi,
    capabilities: ICapabilities,
    roomId: string,
    opts: ICreateClientOpts,
    sendContentLoaded = true,
): MatrixClient {
    installSynchronousCoreManagerExtensions();
    autoInitManagerExtensions(opts);
    return new RoomWidgetClient(widgetApi, capabilities, roomId, amendClientOpts(opts), sendContentLoaded);
}
