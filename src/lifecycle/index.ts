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
 * Lifecycle Manager - 生命周期管理
 *
 * 提供客户端生命周期相关功能
 */

import { MatrixClient } from "../client";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

// 原 `IClientOptions` 已随 `prepare()` 一并删除 —— 它只服务于那个并不存在的方法。

export interface LifecycleManagerEvents {
    client_started: void;
    client_stopped: void;
    client_reset: void;
    client_terminated: void;
}

export class LifecycleManager extends BaseManager<keyof LifecycleManagerEvents, LifecycleManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public async startClient(): Promise<void> {
        return this.withRetry(() => this.client.startClient(), "startClient");
    }

    public async stopClient(): Promise<void> {
        await this.client.stopClient();
    }

    public isClientRunning(): boolean {
        return this.client.clientRunning ?? false;
    }

    // ⚠️ 2026-10-07 删除 `exit` / `terminate` / `reset` / `prepare`：
    // 它们逐个转发 `this.client.exit()` / `.terminate()` / `.reset()` / `.prepare()`，
    // 而 MatrixClient **从未实现**过这四个方法（类型表却声明了它们）⇒ 调用即 TypeError。
    // 与其它空壳模块不同，这里**没有真实能力可以改走** —— Matrix 协议本身就没有
    // "退出 / 终止 / 重置客户端"这类概念，那是宿主应用（Electron / 浏览器）的职责。
    // 留着它们等于留一个"类型检查通过、调用即崩"的陷阱，故直接删除。
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getLifecycleManager = function (): LifecycleManager {
        registerManagerClass("lifecycle", LifecycleManager);
        return getOrCreateManager(this, "lifecycle", () => new LifecycleManager(this));
    };
}
