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
    includeSecureBackup?: boolean;
    includeThirdParty?: boolean;
    includeOidc?: boolean;
    includeTelemetry?: boolean;
    includeRendezvous?: boolean;
    includeTyping?: boolean;
    includeUser?: boolean;
    includeUserReport?: boolean;
    includeThreePids?: boolean;
    includeIdentityServer?: boolean;
    includePasswordReset?: boolean;
    includeThreading?: boolean;
    includeStateSend?: boolean;
    includeRelations?: boolean;
    includeTimeline?: boolean;
    includeModeration?: boolean;
    includeKeyRotation?: boolean;
    includeKeyBackup?: boolean;
    includeFeatureFlag?: boolean;
    includeEventReport?: boolean;
    includeBurnAfterRead?: boolean;
    includeVerification?: boolean;
    includeE2EE?: boolean;
    includeWorkerBody?: boolean;
    includeAiConnection?: boolean;
    includeOpenClaw?: boolean;
    includeVoice?: boolean;
    includeExternalService?: boolean;
    includeSamlAuth?: boolean;
    includeAll?: boolean;
}

export type ManagerExtensionsLifecyclePhase = "register" | "init" | "start" | "stop";
export type ManagerExtensionsLifecycleStatus = "begin" | "success" | "error";

export interface ManagerExtensionsLifecycleEvent {
    phase: ManagerExtensionsLifecyclePhase;
    status: ManagerExtensionsLifecycleStatus;
    modules: string[];
    error?: unknown;
}

export type ManagerExtensionsLifecycleListener = (event: ManagerExtensionsLifecycleEvent) => void;

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
    includeSecureBackup: true,
    includeThirdParty: true,
    includeOidc: true,
    includeTelemetry: true,
    includeRendezvous: true,
    includeTyping: true,
    includeUser: true,
    includeUserReport: true,
    includeThreePids: true,
    includeIdentityServer: true,
    includePasswordReset: true,
    includeThreading: true,
    includeStateSend: true,
    includeRelations: true,
    includeTimeline: true,
    includeModeration: true,
    includeKeyRotation: true,
    includeKeyBackup: true,
    includeFeatureFlag: true,
    includeEventReport: true,
    includeBurnAfterRead: true,
    includeVerification: true,
    includeE2EE: true,
    includeWorkerBody: true,
    includeAiConnection: true,
    includeOpenClaw: true,
    includeVoice: true,
    includeExternalService: true,
    includeSamlAuth: true,
};

let isInitialized = false;
let currentOptions: ManagerExtensionsOptions = {};
let initializationPromise: Promise<void> | null = null;
const lifecycleListeners = new Set<ManagerExtensionsLifecycleListener>();

const MANAGER_EXTENSION_MODULES: Array<{
    option: Exclude<keyof ManagerExtensionsOptions, "includeAll">;
    module: string;
}> = [
    { option: "includeAdmin", module: "admin" },
    { option: "includeAccount", module: "account" },
    { option: "includeAccountData", module: "account-data" },
    { option: "includeAuth", module: "auth" },
    { option: "includeCapabilities", module: "capabilities" },
    { option: "includeCryptoKeys", module: "crypto-keys" },
    { option: "includeKeyVerification", module: "key-verification" },
    { option: "includeDeviceTrust", module: "device-trust" },
    { option: "includeDiscovery", module: "discovery" },
    { option: "includeGlobalLogout", module: "global-logout" },
    { option: "includeDm", module: "dm" },
    { option: "includeGuest", module: "guest" },
    { option: "includeInviteBlocklist", module: "invite-blocklist" },
    { option: "includeMedia", module: "media" },
    { option: "includeMessage", module: "message" },
    { option: "includePush", module: "push" },
    { option: "includeQrLogin", module: "qr-login" },
    { option: "includeRendering", module: "rendering" },
    { option: "includeRoom", module: "room" },
    { option: "includeRoomKeySharing", module: "room-key-sharing" },
    { option: "includeRoomSummary", module: "room-summary" },
    { option: "includeRoomList", module: "room-list" },
    { option: "includeSecurity", module: "security" },
    { option: "includeStickyEvent", module: "sticky-event" },
    { option: "includeFriend", module: "friend" },
    { option: "includeSpace", module: "space" },
    { option: "includeSending", module: "sending" },
    { option: "includePresence", module: "presence" },
    { option: "includeFederation", module: "federation" },
    { option: "includeDevice", module: "device" },
    { option: "includeProfile", module: "profile" },
    { option: "includeSecureBackup", module: "secure-backup" },
    { option: "includeThirdParty", module: "thirdparty" },
    { option: "includeOidc", module: "oidc" },
    { option: "includeTelemetry", module: "telemetry" },
    { option: "includeRendezvous", module: "rendezvous" },
    { option: "includeTyping", module: "typing" },
    { option: "includeUser", module: "user" },
    { option: "includeUserReport", module: "user-report" },
    { option: "includeThreePids", module: "threepids" },
    { option: "includeIdentityServer", module: "identity-server" },
    { option: "includePasswordReset", module: "password-reset" },
    { option: "includeThreading", module: "threading" },
    { option: "includeStateSend", module: "state-send" },
    { option: "includeRelations", module: "relations" },
    { option: "includeTimeline", module: "timeline" },
    { option: "includeModeration", module: "moderation" },
    { option: "includeKeyRotation", module: "key-rotation" },
    { option: "includeKeyBackup", module: "key-backup" },
    { option: "includeFeatureFlag", module: "feature-flags" },
    { option: "includeEventReport", module: "event-report" },
    { option: "includeBurnAfterRead", module: "burn-after-read" },
    { option: "includeVerification", module: "verification" },
    { option: "includeE2EE", module: "e2ee" },
    { option: "includeWorkerBody", module: "worker-body" },
    { option: "includeAiConnection", module: "ai-connection" },
    { option: "includeOpenClaw", module: "openclaw" },
    { option: "includeVoice", module: "voice" },
    { option: "includeExternalService", module: "external-service" },
    { option: "includeSamlAuth", module: "saml-auth" },
];

function emitLifecycleEvent(event: ManagerExtensionsLifecycleEvent): void {
    for (const listener of lifecycleListeners) {
        try {
            listener(event);
        } catch {
            continue;
        }
    }
}

function getEnabledModules(options: ManagerExtensionsOptions): string[] {
    const all = options.includeAll ?? false;
    return MANAGER_EXTENSION_MODULES.filter(({ option }) => all || options[option]).map(({ module }) => module);
}

export function onManagerExtensionsLifecycle(listener: ManagerExtensionsLifecycleListener): () => void {
    lifecycleListeners.add(listener);
    return () => offManagerExtensionsLifecycle(listener);
}

export function offManagerExtensionsLifecycle(listener: ManagerExtensionsLifecycleListener): void {
    lifecycleListeners.delete(listener);
}

export async function extendMatrixClientWithManagers(
    options: ManagerExtensionsOptions = DEFAULT_CORE_EXTENSIONS,
): Promise<void> {
    if (isInitialized) {
        return;
    }
    if (initializationPromise) {
        return initializationPromise;
    }

    initializationPromise = (async (): Promise<void> => {
        currentOptions = { ...DEFAULT_CORE_EXTENSIONS, ...options };
        const all = currentOptions.includeAll ?? false;
        const enabledModules = getEnabledModules(currentOptions);
        emitLifecycleEvent({ phase: "register", status: "success", modules: enabledModules });
        emitLifecycleEvent({ phase: "init", status: "begin", modules: enabledModules });

        const promises: Promise<void>[] = [];

        try {
            if (currentOptions.includeAdmin || all) {
                promises.push(import("../admin/index.js").then((m) => m.extendMatrixClient()));
                promises.push(import("../background-update/index.js").then((m) => m.extendMatrixClient()));
                promises.push(import("../worker-admin/index.js").then((m) => m.extendMatrixClient()));
                promises.push(import("../worker-body/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeAccount || all) {
                promises.push(import("../account/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeAccountData || all) {
                promises.push(import("../account-data/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeAuth || all) {
                promises.push(import("../auth/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeCapabilities || all) {
                promises.push(import("../capabilities/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeCryptoKeys || all) {
                promises.push(import("../crypto-keys/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeKeyVerification || all) {
                promises.push(import("../key-verification/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeDeviceTrust || all) {
                promises.push(import("../device-trust/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeDiscovery || all) {
                promises.push(import("../discovery/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeDm || all) {
                promises.push(import("../dm/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeGlobalLogout || all) {
                promises.push(import("../auth/global-logout.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeGuest || all) {
                promises.push(import("../guest/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeInviteBlocklist || all) {
                promises.push(import("../invite-blocklist/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeMedia || all) {
                promises.push(import("../media/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeMessage || all) {
                promises.push(import("../message/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includePush || all) {
                promises.push(import("../push/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeQrLogin || all) {
                promises.push(import("../qr-login/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeRendering || all) {
                promises.push(import("../rendering/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeRoom || all) {
                promises.push(import("../room/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeRoomKeySharing || all) {
                promises.push(import("../room-key-sharing/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeRoomSummary || all) {
                promises.push(import("../room-summary/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeRoomList || all) {
                promises.push(import("../room-list/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeFriend || all) {
                promises.push(import("../friend/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeSpace || all) {
                promises.push(import("../space/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeSending || all) {
                promises.push(import("../sending/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includePresence || all) {
                promises.push(import("../presence/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeFederation || all) {
                promises.push(import("../federation/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeSecurity || all) {
                promises.push(import("../security/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeStickyEvent || all) {
                promises.push(import("../sticky-event/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeDevice || all) {
                promises.push(import("../device/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeProfile || all) {
                promises.push(import("../profile/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeSecureBackup || all) {
                promises.push(import("../secure-backup/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeThirdParty || all) {
                promises.push(import("../thirdparty/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeOidc || all) {
                promises.push(import("../oidc/manager.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeTelemetry || all) {
                promises.push(import("../telemetry/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeRendezvous || all) {
                promises.push(import("../rendezvous/RendezvousManager.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeTyping || all) {
                promises.push(import("../typing/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeUser || all) {
                promises.push(import("../user/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeUserReport || all) {
                promises.push(import("../user-report/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeThreePids || all) {
                promises.push(import("../threepids/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeIdentityServer || all) {
                promises.push(import("../identity-server/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includePasswordReset || all) {
                promises.push(import("../password-reset/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeThreading || all) {
                promises.push(import("../threading/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeStateSend || all) {
                promises.push(import("../state-send/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeRelations || all) {
                promises.push(import("../relations/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeModeration || all) {
                promises.push(import("../moderation/index").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeTimeline || all) {
                promises.push(import("../timeline/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeKeyRotation || all) {
                promises.push(import("../key-rotation/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeKeyBackup || all) {
                promises.push(import("../key-backup/index").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeFeatureFlag || all) {
                promises.push(import("../feature-flags/index").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeEventReport || all) {
                promises.push(import("../event-report/index").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeBurnAfterRead || all) {
                promises.push(import("../burn-after-read/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeVerification || all) {
                promises.push(import("../verification/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeE2EE || all) {
                promises.push(import("../e2ee/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeAiConnection || all) {
                promises.push(import("../ai-connection/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeOpenClaw || all) {
                promises.push(import("../openclaw/index.js").then((m) => m.extendMatrixClient()));
            }

            if (currentOptions.includeVoice || all) {
                promises.push(import("../voice/index.js").then((m) => m.extendMatrixClient()));
            }

            await Promise.all(promises);
            emitLifecycleEvent({ phase: "init", status: "success", modules: enabledModules });
            isInitialized = true;
            emitLifecycleEvent({ phase: "start", status: "success", modules: enabledModules });
        } catch (error) {
            emitLifecycleEvent({ phase: "init", status: "error", modules: enabledModules, error });
            throw error;
        }
    })();

    try {
        await initializationPromise;
    } finally {
        if (!isInitialized) {
            initializationPromise = null;
        }
    }
}

export function isManagerExtensionsInitialized(): boolean {
    return isInitialized;
}

export function resetManagerExtensions(): void {
    const enabledModules = getEnabledModules(currentOptions);
    emitLifecycleEvent({ phase: "stop", status: "success", modules: enabledModules });
    isInitialized = false;
    currentOptions = {};
    initializationPromise = null;
}

export { DEFAULT_CORE_EXTENSIONS };
