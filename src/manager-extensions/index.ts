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
 * Manager Extensions - 统一的 Manager 初始化入口
 * 
 * 提供统一的接口来初始化所有或部分的 Manager 扩展
 * 使用方式：
 * 
 * @example
 * // 初始化所有核心 Manager
 * import { extendMatrixClientWithManagers } from "./manager-extensions";
 * extendMatrixClientWithManagers();
 * 
 * const client = createClient({ ... });
 * const admin = client.getAdminManager();
 * const dm = client.getDirectMessageManager();
 */

export interface ManagerExtensionsOptions {
    includeAdmin?: boolean;
    includeAccount?: boolean;
    includeAccountData?: boolean;
    includeAuth?: boolean;
    includeCapabilities?: boolean;
    includeCryptoKeys?: boolean;
    includeKeyVerification?: boolean;
    includeDeviceTrust?: boolean;
    includeDiscovery?: boolean;
    includeExternalService?: boolean;
    includeGlobalLogout?: boolean;
    includeDm?: boolean;
    includeGuest?: boolean;
    includeInviteBlocklist?: boolean;
    includeMedia?: boolean;
    includeMessage?: boolean;
    includePush?: boolean;
    includeQrLogin?: boolean;
    includeRendering?: boolean;
    includeRoom?: boolean;
    includeRoomKeySharing?: boolean;
    includeRoomSummary?: boolean;
    includeRoomList?: boolean;
    includeSecurity?: boolean;
    includeStickyEvent?: boolean;
    includeFriend?: boolean;
    includeSpace?: boolean;
    includeSending?: boolean;
    includePresence?: boolean;
    includeFederation?: boolean;
    includeDevice?: boolean;
    includeProfile?: boolean;
    includeSamlAuth?: boolean;
    includeThirdParty?: boolean;
    includeTyping?: boolean;
    includeUser?: boolean;
    includeUserReport?: boolean;
    includeVoice?: boolean;
    includeAll?: boolean;
}

const DEFAULT_CORE_EXTENSIONS: ManagerExtensionsOptions = {
    includeAdmin: true,
    includeAccount: true,
    includeAccountData: true,
    includeAuth: true,
    includeCapabilities: true,
    includeCryptoKeys: true,
    includeKeyVerification: true,
    includeDeviceTrust: true,
    includeDiscovery: true,
    includeDm: true,
    includeExternalService: true,
    includeGlobalLogout: true,
    includeGuest: true,
    includeInviteBlocklist: true,
    includeMedia: true,
    includeMessage: true,
    includePush: true,
    includeQrLogin: true,
    includeRendering: true,
    includeRoom: true,
    includeRoomKeySharing: true,
    includeRoomSummary: true,
    includeRoomList: true,
    includeSecurity: true,
    includeStickyEvent: true,
    includeFriend: true,
    includeSpace: true,
    includeSending: true,
    includePresence: true,
    includeFederation: true,
    includeDevice: true,
    includeProfile: true,
    includeSamlAuth: true,
    includeThirdParty: true,
    includeTyping: true,
    includeUser: true,
    includeUserReport: true,
    includeVoice: true,
};

let isInitialized = false;
let currentOptions: ManagerExtensionsOptions = {};

export async function extendMatrixClientWithManagers(
    options: ManagerExtensionsOptions = DEFAULT_CORE_EXTENSIONS
): Promise<void> {
    if (isInitialized) {
        return;
    }

    currentOptions = { ...DEFAULT_CORE_EXTENSIONS, ...options };
    const all = currentOptions.includeAll ?? false;

    const promises: Promise<void>[] = [];

    if (currentOptions.includeAdmin || all) {
        promises.push(import("../admin/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeAccount || all) {
        promises.push(import("../account/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeAccountData || all) {
        promises.push(import("../account-data/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeAuth || all) {
        promises.push(import("../auth/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeCapabilities || all) {
        promises.push(import("../capabilities/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeCryptoKeys || all) {
        promises.push(import("../crypto-keys/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeKeyVerification || all) {
        promises.push(import("../key-verification/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeDeviceTrust || all) {
        promises.push(import("../device-trust/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeDiscovery || all) {
        promises.push(import("../discovery/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeDm || all) {
        promises.push(import("../dm/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeExternalService || all) {
        promises.push(import("../external-service/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeGlobalLogout || all) {
        promises.push(import("../auth/global-logout.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeGuest || all) {
        promises.push(import("../guest/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeInviteBlocklist || all) {
        promises.push(import("../invite-blocklist/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeMedia || all) {
        promises.push(import("../media/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeMessage || all) {
        promises.push(import("../message/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includePush || all) {
        promises.push(import("../push/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeQrLogin || all) {
        promises.push(import("../qr-login/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeRendering || all) {
        promises.push(import("../rendering/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeRoom || all) {
        promises.push(import("../room/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeRoomKeySharing || all) {
        promises.push(import("../room-key-sharing/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeRoomSummary || all) {
        promises.push(import("../room-summary/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeRoomList || all) {
        promises.push(import("../room-list/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeFriend || all) {
        promises.push(import("../friend/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeSpace || all) {
        promises.push(import("../space/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeSending || all) {
        promises.push(import("../sending/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includePresence || all) {
        promises.push(import("../presence/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeFederation || all) {
        promises.push(import("../federation/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeSecurity || all) {
        promises.push(import("../security/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeStickyEvent || all) {
        promises.push(import("../sticky-event/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeDevice || all) {
        promises.push(import("../device/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeProfile || all) {
        promises.push(import("../profile/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeSamlAuth || all) {
        promises.push(import("../saml/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeThirdParty || all) {
        promises.push(import("../thirdparty/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeTyping || all) {
        promises.push(import("../typing/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeUser || all) {
        promises.push(import("../user/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeUserReport || all) {
        promises.push(import("../user-report/index.js").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeVoice || all) {
        promises.push(import("../voice/index.js").then(m => m.extendMatrixClient()));
    }

    await Promise.all(promises);
    isInitialized = true;
}

export function isManagerExtensionsInitialized(): boolean {
    return isInitialized;
}

export function resetManagerExtensions(): void {
    isInitialized = false;
    currentOptions = {};
}

export { DEFAULT_CORE_EXTENSIONS };
