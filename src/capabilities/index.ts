/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may May obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * Capabilities Manager - 能力查询
 *
 * 提供服务器能力查询功能
 */

import { MatrixClient } from "../client";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface IServerCapabilities {
    capabilities: {
        [key: string]: {
            enabled?: boolean;
            available?: boolean;
            [key: string]: unknown;
        };
    };
}

export interface CapabilitiesManagerEvents {
    capabilities_updated: { capabilities: IServerCapabilities };
    capability_changed: { capability: string; enabled: boolean };
}

export class CapabilitiesManager extends BaseManager<keyof CapabilitiesManagerEvents, CapabilitiesManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 获取服务器能力（优先返回缓存）。
     *
     * 先读取本地缓存，缓存未命中时再向服务器拉取。
     *
     * @returns 服务器能力；服务不可用时返回 undefined
     *
     * @example
     * ```typescript
     * const capabilities = await client.getCapabilitiesManager().getCapabilities();
     * console.log(capabilities?.capabilities);
     * ```
     */
    public async getCapabilities(): Promise<IServerCapabilities | undefined> {
        const cached = this.getCachedCapabilities();
        if (cached) return cached;
        return this.fetchCapabilities();
    }

    /**
     * 获取已缓存的服务器能力（不发起网络请求）。
     *
     * @returns 已缓存的服务器能力；无缓存时返回 undefined
     *
     * @example
     * ```typescript
     * const cached = client.getCapabilitiesManager().getCachedCapabilities();
     * console.log(cached?.capabilities);
     * ```
     */
    public getCachedCapabilities(): IServerCapabilities | undefined {
        return (
            this.internalClient as unknown as {
                serverCapabilitiesService?: {
                    getCachedCapabilities: () => IServerCapabilities | undefined;
                };
            }
        ).serverCapabilitiesService?.getCachedCapabilities();
    }

    /**
     * 强制从服务器拉取能力（忽略本地缓存）。
     *
     * @returns 服务器能力；服务不可用时返回 undefined
     *
     * @example
     * ```typescript
     * const capabilities = await client.getCapabilitiesManager().fetchCapabilities();
     * console.log(capabilities?.capabilities);
     * ```
     */
    public async fetchCapabilities(): Promise<IServerCapabilities | undefined> {
        return this.withRetry(async () => {
            const service = (
                this.internalClient as unknown as {
                    serverCapabilitiesService?: {
                        fetchCapabilities: () => Promise<IServerCapabilities>;
                    };
                }
            ).serverCapabilitiesService;
            return service?.fetchCapabilities();
        }, "fetchCapabilities");
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getCapabilitiesManager = function (): CapabilitiesManager {
        registerManagerClass("capabilities", CapabilitiesManager);
        return getOrCreateManager(this, "capabilities", () => new CapabilitiesManager(this));
    };
}
