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

import { type IHttpOpts, type MatrixHttpApi, Method } from "./http-api/index";
import { type Logger } from "./logger";

// How often we update the server capabilities.
// 6 hours - an arbitrary value, but they should change very infrequently.
const CAPABILITIES_CACHE_MS = 6 * 60 * 60 * 1000;

// How long we want before retrying if we couldn't fetch
const CAPABILITIES_RETRY_MS = 30 * 1000;

export interface ICapability {
    enabled: boolean;
}

export interface IChangePasswordCapability extends ICapability {}

export interface IThreadsCapability extends ICapability {}

export interface IGetLoginTokenCapability extends ICapability {}

export interface ISetDisplayNameCapability extends ICapability {}

export interface ISetAvatarUrlCapability extends ICapability {}

export interface IProfileFieldsCapability extends ICapability {}

export interface ISsoCapability extends ICapability {
    enabled: boolean;
    providers?: string[];
}

export enum RoomVersionStability {
    Stable = "stable",
    Unstable = "unstable",
}

export interface IRoomVersionsCapability {
    default: string;
    available: Record<string, RoomVersionStability>;
}

/**
 * A representation of the capabilities advertised by a homeserver as defined by
 * [Capabilities negotiation](https://spec.matrix.org/v1.6/client-server-api/#get_matrixclientv3capabilities).
 */
export interface Capabilities {
    [key: string]: unknown;
    "m.change_password"?: IChangePasswordCapability;
    "m.room_versions"?: IRoomVersionsCapability;
    "io.element.thread"?: IThreadsCapability;
    "m.get_login_token"?: IGetLoginTokenCapability;
    "org.matrix.msc3882.get_login_token"?: IGetLoginTokenCapability;
    "m.set_displayname"?: ISetDisplayNameCapability;
    "m.set_avatar_url"?: ISetAvatarUrlCapability;
    "uk.tcpip.msc4133.profile_fields"?: IProfileFieldsCapability;
    /**
     * Since Matrix v1.16
     */
    "m.profile_fields"?: IProfileFieldsCapability;
    "m.sso"?: ISsoCapability;
    // ---- FT-099: Synapse-Rust 扩展 capability key ----
    // 以下为 synapse-rust 后端通过 GET /capabilities 返回的扩展能力声明。
    // 运行时解析逻辑见 server-capabilities/index.ts 的 SYNAPSE_RUST_CAPABILITY_ALIASES。
    /** 阅后即焚（burn-after-read feature） */
    "io.hula.burn_after_read"?: ICapability;
    /** 好友系统（friends feature） */
    "io.hula.friends"?: ICapability;
    /** 语音消息扩展（voice-extended feature），与 m.voice 别名等价 */
    "io.hula.voice_extended"?: ICapability;
    /** Matrix 标准语音（与 io.hula.voice_extended 别名等价） */
    "m.voice"?: ICapability;
    /** 不稳定特性集合（unstable features） - 后端返回在顶层 unstable_features */
    unstable_features?: Record<string, boolean>;
}

type CapabilitiesResponse = {
    capabilities: Capabilities;
    /**
     * Synapse-Rust 后端在响应顶层返回 `unstable_features`
     * （如 `org.matrix.msc4204`、`io.hula.friends` 等能力开关），
     * 标准客户端通常忽略，但本 fork 需要 `hasUnstableFeature()` 判定。
     */
    unstable_features?: Record<string, boolean>;
};

/**
 * Manages storing and periodically refreshing the server capabilities.
 */
export class ServerCapabilities {
    private capabilities?: Capabilities;
    /**
     * Top-level `unstable_features` from the `/capabilities` response.
     * Synapse-Rust returns it alongside `capabilities`; stock servers omit it.
     */
    private unstableFeatures?: Record<string, boolean>;
    private retryTimeout?: ReturnType<typeof setTimeout>;
    // S-15: was typed as `ReturnType<typeof setInterval>` while `poll()` assigns a `setTimeout`
    // handle to it. Corrected to `setTimeout` so `clearTimeouts()` clears it with the matching
    // `clearTimeout` (relying on clearTimeout/clearInterval cross-clearing is not portable).
    private refreshTimeout?: ReturnType<typeof setTimeout>;
    /**
     * S-15: Re-entrancy guard. `start()` used to unconditionally kick off `poll()`, so two
     * concurrent callers (e.g. `MatrixClient.startClient()` racing an explicit
     * `fetchServerCapabilities()` caller) spawned two independent self-rescheduling poll chains.
     * Each chain re-arms itself forever, so the duplicate was never collected and every
     * subsequent `stop()` only ever cleared one of them.
     */
    private started = false;

    public constructor(
        private readonly logger: Logger,
        private readonly http: MatrixHttpApi<IHttpOpts & { onlyData: true }>,
    ) {}

    /**
     * Starts periodically fetching the server capabilities.
     * Idempotent: calling this while already started is a no-op.
     */
    public start(): void {
        if (this.started) return;
        this.started = true;
        this.poll().then();
    }

    /**
     * Stops the service
     */
    public stop(): void {
        this.started = false;
        this.clearTimeouts();
    }

    /**
     * Returns the cached capabilities, or undefined if none are cached.
     * @returns the current capabilities, if any.
     */
    public getCachedCapabilities(): Capabilities | undefined {
        return this.capabilities;
    }

    /**
     * Fetches the latest server capabilities from the homeserver and returns them, or rejects
     * on failure.
     */
    public fetchCapabilities = async (): Promise<Capabilities> => {
        const resp = await this.http.authedRequest<CapabilitiesResponse>(Method.Get, "/capabilities");
        this.capabilities = resp["capabilities"];
        // Preserve the top-level unstable_features that synapse-rust returns alongside
        // `capabilities`; stock servers omit it and the field simply stays undefined.
        this.unstableFeatures = resp["unstable_features"];
        return this.capabilities;
    };

    /**
     * Returns the cached `unstable_features` from the last capabilities fetch,
     * or undefined if none are cached (or the server did not send any).
     *
     * Synapse-Rust 后端在 `/capabilities` 响应顶层返回 `unstable_features`，
     * 包含如 `org.matrix.msc4204`、`io.hula.friends` 等布尔型能力开关。
     */
    public getUnstableFeatures(): Record<string, boolean> | undefined {
        return this.unstableFeatures;
    }

    /**
     * Checks whether the server advertises a specific unstable feature.
     *
     * Matching is **exact**, against the keys the server actually sent in the
     * top-level `unstable_features` map.
     *
     * The previous implementation guessed the key by string-prefixing the
     * argument (`org.matrix.msc${name}`). That happened to work for keys the
     * server already spells `org.matrix.mscNNNN…`, but produced garbage for
     * every other key: `io.hula.friends` was looked up as
     * `org.matrix.mscio.hula.friends`, `uk.tcpip.msc4133` as
     * `org.matrix.mscuk.tcpip.msc4133`. Of the nine keys the synapse-rust
     * backend emits (`synapse-services/src/capability_governance.rs:451-465`)
     * only five were ever matchable.
     *
     * The real key set is:
     * `io.hula.friends`, `org.matrix.msc3245.voice`,
     * `org.matrix.msc3983.thread`, `org.matrix.msc3886.sliding_sync`,
     * `org.matrix.simplified_msc3575`, `org.matrix.msc4186`,
     * `io.hula.burn_after_read`, `org.matrix.msc4108`, `uk.tcpip.msc4133`.
     *
     * @param name - the exact feature key. A bare MSC number (`"4204"` or
     *   `"msc4204"`) is also accepted and expanded to `org.matrix.msc4204`;
     *   anything else must be passed verbatim.
     * @returns true only when the server sent that key with a `true` value.
     */
    public hasUnstableFeature(name: string): boolean {
        const features = this.unstableFeatures;
        if (!features || !name) return false;

        if (features[name] === true) return true;

        // Convenience expansion for the two common MSC spellings. The result is
        // still required to be present in the server's map, so this can only
        // ever produce a false *negative*, never a false positive — and a key
        // living under another namespace (e.g. `uk.tcpip.msc4133`) must be
        // passed in full.
        const mscMatch = /^(?:org\.matrix\.)?(?:msc)?(\d+)$/.exec(name);
        if (mscMatch) {
            return features[`org.matrix.msc${mscMatch[1]}`] === true;
        }
        return false;
    }

    private poll = async (): Promise<void> => {
        try {
            await this.fetchCapabilities();
            this.clearTimeouts();
            // S-15: `stop()` may have been called while the fetch was in flight; do not
            // resurrect the poll chain in that case.
            if (!this.started) return;
            this.refreshTimeout = setTimeout(this.poll, CAPABILITIES_CACHE_MS);
            this.logger.debug("Fetched new server capabilities");
        } catch (e) {
            this.clearTimeouts();
            if (!this.started) return;
            const howLong = Math.floor(CAPABILITIES_RETRY_MS + Math.random() * 5000);
            this.retryTimeout = setTimeout(this.poll, howLong);
            this.logger.warn(`Failed to refresh capabilities: retrying in ${howLong}ms`, e);
        }
    };

    private clearTimeouts(): void {
        if (this.refreshTimeout) {
            // S-15: was `clearInterval` on a `setTimeout` handle.
            clearTimeout(this.refreshTimeout);
            this.refreshTimeout = undefined;
        }
        if (this.retryTimeout) {
            clearTimeout(this.retryTimeout);
            this.retryTimeout = undefined;
        }
    }
}
