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
    includeDm?: boolean;
    includePush?: boolean;
    includeRoomSummary?: boolean;
    includeRoomList?: boolean;
    includeFriend?: boolean;
    includeSpace?: boolean;
    includeSending?: boolean;
    includeAll?: boolean;
}

const DEFAULT_CORE_EXTENSIONS: ManagerExtensionsOptions = {
    includeAdmin: true,
    includeDm: true,
    includePush: true,
    includeRoomSummary: true,
    includeRoomList: true,
    includeFriend: true,
    includeSpace: true,
    includeSending: true,
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
        promises.push(import("../admin/index").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeDm || all) {
        promises.push(import("../dm/index").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includePush || all) {
        promises.push(import("../push/index").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeRoomSummary || all) {
        promises.push(import("../room-summary/index").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeRoomList || all) {
        promises.push(import("../room-list/index").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeFriend || all) {
        promises.push(import("../friend/index").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeSpace || all) {
        promises.push(import("../space/index").then(m => m.extendMatrixClient()));
    }

    if (currentOptions.includeSending || all) {
        promises.push(import("../sending/index").then(m => m.extendMatrixClient()));
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
