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
 * Server Capabilities Manager - 服务器能力管理
 *
 * 提供服务器能力相关功能
 */

import { MatrixClient } from "../client";
import { Preset } from "../@types/partials";
import { determineFeatureSupport, FeatureSupport } from "../models/thread";
import { Feature, ServerSupport } from "../feature";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { type Capabilities } from "../serverCapabilities";
import { type IServerVersions } from "../client-api-types";
import { type QueryDict } from "../http-api/utils";
import { buildFeatureSupportMap } from "../feature";
import * as utils from "../utils";

const UNSTABLE_MSC2666_SHARED_ROOMS = "uk.half-shot.msc2666";
const UNSTABLE_MSC2666_MUTUAL_ROOMS = "uk.half-shot.msc2666.mutual_rooms";
const UNSTABLE_MSC2666_QUERY_MUTUAL_ROOMS = "uk.half-shot.msc2666.query_mutual_rooms";

// How often we update the server capabilities cache.
// 6 hours - an arbitrary value, but they should change very infrequently.
const CAPABILITIES_CACHE_MS = 6 * 60 * 60 * 1000;

export const SynapseRustFeature = {
    ExtendedProfile: "uk.tcpip.msc4133",
    SlidingSync: "org.matrix.msc3886.sliding_sync",
    DehydratedDevice: "org.matrix.msc3814",
    Widget: "org.matrix.msc4261.widget",
    BurnAfterRead: "io.hula.burn_after_read",
    Friends: "io.hula.friends",
    Voice: "org.matrix.msc3245",
    OpenClaw: "openclaw",
    AIConnection: "ai_connection",
} as const;

export type SynapseRustFeatureName = (typeof SynapseRustFeature)[keyof typeof SynapseRustFeature];

export interface SynapseRustFeatureDiscoveryClient {
    doesServerAdvertiseSynapseRustFeature?: (feature: SynapseRustFeatureName) => Promise<boolean>;
}

export interface SynapseRustFeatureSupport {
    extendedProfile: boolean;
    slidingSync: boolean;
    dehydratedDevice: boolean;
    widget: boolean;
    burnAfterRead: boolean;
    friends: boolean;
    voice: boolean;
    openClaw: boolean;
    aiConnection: boolean;
}

const SYNAPSE_RUST_FEATURE_KEYS: Record<keyof SynapseRustFeatureSupport, SynapseRustFeatureName> = {
    extendedProfile: SynapseRustFeature.ExtendedProfile,
    slidingSync: SynapseRustFeature.SlidingSync,
    dehydratedDevice: SynapseRustFeature.DehydratedDevice,
    widget: SynapseRustFeature.Widget,
    burnAfterRead: SynapseRustFeature.BurnAfterRead,
    friends: SynapseRustFeature.Friends,
    voice: SynapseRustFeature.Voice,
    openClaw: SynapseRustFeature.OpenClaw,
    aiConnection: SynapseRustFeature.AIConnection,
};

const SYNAPSE_RUST_CAPABILITY_ALIASES: Partial<Record<SynapseRustFeatureName, string[]>> = {
    [SynapseRustFeature.SlidingSync]: ["io.hula.sliding_sync"],
    [SynapseRustFeature.Widget]: ["io.hula.widget"],
    [SynapseRustFeature.BurnAfterRead]: ["io.hula.burn_after_read"],
    [SynapseRustFeature.Friends]: ["io.hula.friends"],
    [SynapseRustFeature.Voice]: ["m.voice", "io.hula.voice_extended"],
    [SynapseRustFeature.OpenClaw]: ["openclaw"],
    [SynapseRustFeature.AIConnection]: ["ai_connection"],
};

function capabilityEnabled(value: unknown): boolean {
    if (typeof value === "boolean") {
        return value;
    }
    if (value && typeof value === "object" && "enabled" in value) {
        return (value as { enabled?: unknown }).enabled === true;
    }
    return false;
}

export function isUnstableFeatureEnabled(versions: IServerVersions | undefined, feature: string): boolean {
    return versions?.unstable_features?.[feature] === true;
}

export function isCapabilityEnabled(capabilities: Capabilities | undefined, capability: string): boolean {
    return capabilityEnabled(capabilities?.[capability]);
}

export async function doesClientAdvertiseSynapseRustFeature(
    client: SynapseRustFeatureDiscoveryClient,
    feature: SynapseRustFeatureName,
    fallback: boolean,
    onError?: (error: unknown) => void,
): Promise<boolean> {
    const checker = client.doesServerAdvertiseSynapseRustFeature;
    if (!checker) {
        return fallback;
    }

    try {
        return await checker.call(client, feature);
    } catch (e) {
        onError?.(e);
        return fallback;
    }
}

export function resolveSynapseRustFeatureSupport(
    versions: IServerVersions | undefined,
    capabilities?: Capabilities,
): SynapseRustFeatureSupport {
    const support = {} as SynapseRustFeatureSupport;

    for (const [key, feature] of Object.entries(SYNAPSE_RUST_FEATURE_KEYS) as Array<
        [keyof SynapseRustFeatureSupport, SynapseRustFeatureName]
    >) {
        const capabilityAliases = SYNAPSE_RUST_CAPABILITY_ALIASES[feature] ?? [];
        support[key] =
            isUnstableFeatureEnabled(versions, feature) ||
            capabilityAliases.some((capability) => isCapabilityEnabled(capabilities, capability));
    }

    return support;
}

export interface ServerCapabilities {}

export interface ServerCapabilitiesManagerEvents {
    capabilities_updated: { capabilities: ServerCapabilities };
    server_version_updated: { version: string };
}

export class ServerCapabilitiesManager extends BaseManager<
    keyof ServerCapabilitiesManagerEvents,
    ServerCapabilitiesManagerEvents
> {
    /** Cached capabilities response */
    private cachedCapabilities?: Capabilities;
    /** Timestamp of when the capabilities cache was last fetched */
    private capabilitiesFetchedAt = 0;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public async getServerCapabilities(): Promise<Capabilities> {
        const now = Date.now();
        if (this.cachedCapabilities && now - this.capabilitiesFetchedAt < CAPABILITIES_CACHE_MS) {
            return this.cachedCapabilities;
        }
        return this.withRetry(async () => {
            const resp = await this.request<{ capabilities: Capabilities }>({
                method: Method.Get,
                path: "/capabilities",
                prefix: ClientPrefix.V3,
            });
            this.cachedCapabilities = resp["capabilities"];
            this.capabilitiesFetchedAt = Date.now();
            return this.cachedCapabilities!;
        }, "getServerCapabilities");
    }

    public hasServerSupport(feature: string): boolean {
        // Use doesServerSupportUnstableFeature which has independent logic via this.client.getVersions()
        // Note: doesServerSupportUnstableFeature is async, but hasServerSupport is sync.
        // We fall back to checking canSupport map which is synchronously available.
        return this.client.canSupport.get(feature as Feature) !== ServerSupport.Unsupported;
    }

    public async getServerVersion(): Promise<string> {
        const { versions } = await this.client.getVersions();
        return versions?.[0] ?? "";
    }

    /**
     * Check if a particular spec version is supported by the server.
     * @param version - The spec version (such as "r0.5.0") to check for.
     * @returns Whether it is supported
     */
    public async isVersionSupported(version: string): Promise<boolean> {
        const { versions } = await this.client.getVersions();
        return versions && versions.includes(version);
    }

    /**
     * Query the server to see if it lists support for an unstable feature
     * in the /versions response
     * @param feature - the feature name
     * @returns true if the feature is supported
     */
    public async doesServerSupportUnstableFeature(feature: string): Promise<boolean> {
        const response = await this.client.getVersions();
        if (!response) return false;
        return isUnstableFeatureEnabled(response, feature);
    }

    public async doesServerAdvertiseSynapseRustFeature(feature: SynapseRustFeatureName): Promise<boolean> {
        const [versions, capabilities] = await Promise.all([
            this.client.getVersions(),
            this.getServerCapabilities().catch(() => undefined),
        ]);
        return (
            isUnstableFeatureEnabled(versions, feature) ||
            (SYNAPSE_RUST_CAPABILITY_ALIASES[feature] ?? []).some((capability) =>
                isCapabilityEnabled(capabilities, capability),
            )
        );
    }

    public async getSynapseRustFeatureSupport(): Promise<SynapseRustFeatureSupport> {
        const [versions, capabilities] = await Promise.all([
            this.client.getVersions(),
            this.getServerCapabilities().catch(() => undefined),
        ]);
        return resolveSynapseRustFeatureSupport(versions, capabilities);
    }

    /**
     * Query the server to see if it is forcing encryption to be enabled for
     * a given room preset, based on the /versions response.
     * @param presetName - The name of the preset to check.
     * @returns true if the server is forcing encryption
     * for the preset.
     */
    public async doesServerForceEncryptionForPreset(presetName: Preset): Promise<boolean> {
        const response = await this.client.getVersions();
        if (!response) return false;
        const unstableFeatures = response["unstable_features"];

        // The preset name in the versions response will be without the _chat suffix.
        const versionsPresetName = presetName.includes("_chat")
            ? presetName.substring(0, presetName.indexOf("_chat"))
            : presetName;

        return unstableFeatures && !!unstableFeatures[`io.element.e2ee_forced.${versionsPresetName}`];
    }

    public async doesServerSupportThread(): Promise<{
        threads: FeatureSupport;
        list: FeatureSupport;
        fwdPagination: FeatureSupport;
    }> {
        if (await this.isVersionSupported("v1.4")) {
            return {
                threads: FeatureSupport.Stable,
                list: FeatureSupport.Stable,
                fwdPagination: FeatureSupport.Stable,
            };
        }

        try {
            const [threadUnstable, threadStable, listUnstable, listStable, fwdPaginationUnstable, fwdPaginationStable] =
                await Promise.all([
                    this.doesServerSupportUnstableFeature("org.matrix.msc3440"),
                    this.doesServerSupportUnstableFeature("org.matrix.msc3440.stable"),
                    this.doesServerSupportUnstableFeature("org.matrix.msc3856"),
                    this.doesServerSupportUnstableFeature("org.matrix.msc3856.stable"),
                    this.doesServerSupportUnstableFeature("org.matrix.msc3715"),
                    this.doesServerSupportUnstableFeature("org.matrix.msc3715.stable"),
                ]);

            return {
                threads: determineFeatureSupport(threadStable, threadUnstable),
                list: determineFeatureSupport(listStable, listUnstable),
                fwdPagination: determineFeatureSupport(fwdPaginationStable, fwdPaginationUnstable),
            };
        } catch {
            return {
                threads: FeatureSupport.None,
                list: FeatureSupport.None,
                fwdPagination: FeatureSupport.None,
            };
        }
    }

    /**
     * A helper to determine thread support
     * @returns a boolean to determine if threads are enabled
     */
    public supportsThreads(): boolean {
        return this.client.getClientOpts()?.threadSupport || false;
    }

    /**
     * A helper to determine intentional mentions support
     * @returns a boolean to determine if intentional mentions are enabled on the server
     * @experimental
     */
    public supportsIntentionalMentions(): boolean {
        return this.client.canSupport.get(Feature.IntentionalMentions) !== ServerSupport.Unsupported;
    }

    /**
     * Get if lazy loading members is being used.
     * @returns Whether or not members are lazy loaded by this client
     */
    public hasLazyLoadMembersEnabled(): boolean {
        return !!this.client.getClientOpts()?.lazyLoadMembers;
    }

    public supportsLocation(): boolean {
        return this.client.canSupport.get(Feature.Location) !== ServerSupport.Unsupported;
    }

    /**
     * Get the API versions supported by the server, along with any
     * unstable APIs it supports.
     * Caches the result and builds the feature support map.
     * @returns The server /versions response
     */
    public async getVersions(): Promise<IServerVersions> {
        const client = this.client as unknown as {
            serverVersionsPromise?: Promise<IServerVersions>;
            canSupport: Map<import("../feature").Feature, import("../feature").ServerSupport>;
        };
        if (client.serverVersionsPromise) {
            return client.serverVersionsPromise;
        }

        client.serverVersionsPromise = this.client.http
            .authedRequest<IServerVersions>(Method.Get, "/_matrix/client/versions", undefined, undefined, {
                prefix: "",
            })
            .catch((e: Error) => {
                client.serverVersionsPromise = undefined;
                throw e;
            });

        const serverVersions = await client.serverVersionsPromise;
        client.canSupport = await buildFeatureSupportMap(serverVersions);

        return client.serverVersionsPromise;
    }

    /**
     * Gets a set of room IDs in common with another user.
     * Note: This endpoint is unstable (MSC2666).
     * @param userId - The userId to check.
     * @returns Promise which resolves to an array of rooms
     */
    public async _unstable_getSharedRooms(userId: string): Promise<string[]> {
        const sharedRoomsSupport = await this.doesServerSupportUnstableFeature(UNSTABLE_MSC2666_SHARED_ROOMS);
        const mutualRoomsSupport = await this.doesServerSupportUnstableFeature(UNSTABLE_MSC2666_MUTUAL_ROOMS);
        const queryMutualRoomsSupport = await this.doesServerSupportUnstableFeature(
            UNSTABLE_MSC2666_QUERY_MUTUAL_ROOMS,
        );

        if (!sharedRoomsSupport && !mutualRoomsSupport && !queryMutualRoomsSupport) {
            throw Error("Server does not support the Mutual Rooms API");
        }

        let path;
        let query;

        if (queryMutualRoomsSupport) {
            path = "/uk.half-shot.msc2666/user/mutual_rooms";
            query = { user_id: userId };
        } else {
            path = utils.encodeUri(
                `/uk.half-shot.msc2666/user/${mutualRoomsSupport ? "mutual_rooms" : "shared_rooms"}/$userId`,
                { $userId: userId },
            );
            query = {};
        }

        const rooms: string[] = [];
        let token = null;

        do {
            const tokenQuery: Record<string, string> = {};
            if (token != null && queryMutualRoomsSupport) {
                tokenQuery["batch_token"] = token;
            }

            const res = await this.request<{
                joined: string[];
                next_batch_token?: string;
            }>({
                method: Method.Get,
                path: path,
                queryParams: { ...query, ...tokenQuery } as QueryDict,
                prefix: ClientPrefix.Unstable,
            });

            rooms.push(...res.joined);

            if (res.next_batch_token !== undefined) {
                token = res.next_batch_token;
            } else {
                token = null;
            }
        } while (token != null);

        return rooms;
    }

    /**
     * Returns a set of configured RTC transports supported by the homeserver.
     * Requires homeserver support for MSC4143.
     * @throws A M_NOT_FOUND error if not supported by the homeserver.
     */
    public async _unstable_getRTCTransports(): Promise<Record<string, unknown>[]> {
        // Dynamic: RTC transport configs vary by transport type
        return (
            await this.request<{
                rtc_transports: Record<string, unknown>[]; // Dynamic: RTC transport configs vary by transport type
            }>({
                method: Method.Get,
                path: "/rtc/transports",
                prefix: `${ClientPrefix.Unstable}/org.matrix.msc4143`,
            })
        ).rtc_transports;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getServerCapabilitiesManager = function (): ServerCapabilitiesManager {
        registerManagerClass("serverCapabilities", ServerCapabilitiesManager);
        return getOrCreateManager(this, "serverCapabilities", () => new ServerCapabilitiesManager(this));
    };
}
