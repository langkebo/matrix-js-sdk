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
    includePush?: boolean;
    includeQrLogin?: boolean;
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
    includeSamlAuth?: boolean;
    includeCredentials?: boolean;
    includeCas?: boolean;
    includeExternalService?: boolean;
    includeDehydratedDevice?: boolean;
    includeThread?: boolean;
    includeWidget?: boolean;

    includeServerCapabilities?: boolean;
    includeSyncManagement?: boolean;
    includeFilter?: boolean;
    includeToDevice?: boolean;
    includeTurnServer?: boolean;
    includeSearch?: boolean;
    includeReporting?: boolean;
    includeReadReceipts?: boolean;
    includeNotifications?: boolean;
    includeCryptoBackup?: boolean;
    includeTagsManagement?: boolean;
    includeSecretStorage?: boolean;
    includeCrossSigning?: boolean;
    includeRoomSettings?: boolean;
    includeRoomState?: boolean;
    includeServerTime?: boolean;
    includeVoipCalls?: boolean;
    includeRoomAccountData?: boolean;
    includeBackgroundUpdate?: boolean;
    includeUserDirectory?: boolean;
    includeManagerAccessor?: boolean;
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
