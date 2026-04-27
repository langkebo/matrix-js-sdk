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

import { MemoryCryptoStore } from "./crypto/store/memory-crypto-store";
import { MemoryStore } from "./store/memory";
import { MatrixScheduler } from "./scheduler";
import { MatrixClient, type ICreateClientOpts } from "./client";
import { RoomWidgetClient, type ICapabilities } from "./embedded";
import { type CryptoStore } from "./crypto/store/base";
import { logger } from "./logger";
import { extendMatrixClientWithManagers, isManagerExtensionsInitialized } from "./manager-extensions";
import { extendMatrixClient as extendRoom } from "./room";
import { extendMatrixClient as extendEvent } from "./event";

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
export * from "./@types/threepids";
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
export { createNewMatrixCall, CallEvent } from "./webrtc/call";
export type { MatrixCall } from "./webrtc/call";
export {
    GroupCall,
    GroupCallEvent,
    GroupCallIntent,
    GroupCallState,
    GroupCallType,
    GroupCallStatsReportEvent,
} from "./webrtc/groupCall";

export { SyncState, SetPresence } from "./sync";
export type { ISyncStateData as SyncStateData } from "./sync";
export { SlidingSyncEvent, SlidingSyncState, SlidingSync } from "./sliding-sync";
export type {
    MSC3575SlidingSyncResponse,
    MSC3575RoomData,
    MSC3575List,
    MSC3575RoomSubscription,
    MSC3575Filter,
} from "./sliding-sync";
export { SlidingSyncSdk } from "./sliding-sync-sdk";
export { VoiceEvent } from "./voice/index";
export { MediaHandlerEvent } from "./webrtc/mediaHandler";
export { CallFeedEvent } from "./webrtc/callFeed";
export { StatsReport } from "./webrtc/stats/statsReport";
export { Relations, RelationsEvent } from "./models/relations";
export { TypedEventEmitter } from "./models/typed-event-emitter";
export { LocalStorageErrors, localStorageErrorsEventsEmitter } from "./store/local-storage-events-emitter";
export { IdentityProviderBrand, SSOAction } from "./@types/auth";
export type { ISSOFlow as SSOFlow, LoginFlow } from "./@types/auth";
export type { IHierarchyRelation as HierarchyRelation, IHierarchyRoom as HierarchyRoom } from "./@types/spaces";
export { DebugLogger } from "./logger";
export {
    extendMatrixClientWithManagers,
    offManagerExtensionsLifecycle,
    onManagerExtensionsLifecycle,
    isManagerExtensionsInitialized,
    resetManagerExtensions,
    type ManagerExtensionsLifecycleEvent,
    type ManagerExtensionsLifecycleListener,
    type ManagerExtensionsLifecyclePhase,
    type ManagerExtensionsLifecycleStatus,
    type ManagerExtensionsOptions,
} from "./manager-extensions";

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

function autoInitManagerExtensions(opts: ICreateClientOpts): void {
    if (opts.disableDynamicExtensions) {
        return;
    }

    extendRoom();
    extendEvent();

    if (isManagerExtensionsInitialized()) {
        return;
    }

    void initializeManagerExtensions().catch((error) => {
        logger.warn("createClient auto manager extension init failed:", error);
    });
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
    autoInitManagerExtensions(opts);
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
    autoInitManagerExtensions(opts);
    return new RoomWidgetClient(widgetApi, capabilities, roomId, amendClientOpts(opts), sendContentLoaded);
}
