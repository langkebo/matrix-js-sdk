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
 * Delayed Events Manager - MSC4140 延迟事件管理
 *
 * 提供已调度延迟事件的管理操作：取消、重启（心跳）、强制发送。
 *
 * SDK-BL-004/005: 此前延迟事件管理能力直接挂在 `MatrixClient` 上
 * (`src/client.ts` 的 `_unstable_*` 方法)，且 cancel/restart/send 系列优先
 * 尝试 action-in-PATH (`/delayed_events/{id}/{action}`)，后端不支持该路径，
 * 触发 `M_UNRECOGNIZED` 后才 fallback 到 action-in-BODY —— 每次管理操作多
 * 一次失败请求。本 Manager 统一使用后端支持的 action-in-BODY 单次请求
 * (`POST /delayed_events/{delay_id}` body `{ action }`)，删除 fallback。
 *
 * 后端实现: synapse-rust/src/web/routes/delayed_events.rs
 *   POST /_matrix/client/unstable/org.matrix.msc4140/delayed_events/{delay_id}
 *   { "action": "send" | "cancel" | "restart" }
 *
 * `MatrixClient` 上的 `_unstable_cancelScheduledDelayedEvent` 等方法保留为
 * 向后兼容的委托方法，内部转发到本 Manager。
 */

import type { EmptyObject } from "../@types/common";
import type { IRequestOpts } from "../http-api/interface";
import { Method } from "../http-api/method";
import { UnsupportedDelayedEventsEndpointError, ValidationError } from "../errors";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { MatrixClient } from "../client";
import { getOrCreateManager, registerManagerClass } from "../client-infra/manager-registry";
import { UpdateDelayedEventAction } from "../@types/requests";
import { buildDelayedEventsPath, buildUnstableFeaturePrefix } from "../client-delayed-events";

/** MSC4140 unstable feature name. Local copy to avoid a runtime circular import of `client.ts`. */
const UNSTABLE_MSC4140_DELAYED_EVENTS = "org.matrix.msc4140";

const DELAYED_EVENTS_PREFIX = buildUnstableFeaturePrefix(UNSTABLE_MSC4140_DELAYED_EVENTS);

type DelayedEventClientEndpoint =
    | "cancelScheduledDelayedEvent"
    | "restartScheduledDelayedEvent"
    | "sendScheduledDelayedEvent";

export class DelayedEventsManager extends BaseManager {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /** 抛出 `UnsupportedDelayedEventsEndpointError` 当服务端未声明 MSC4140 支持。 */
    private async assertSupported(apiName: DelayedEventClientEndpoint): Promise<void> {
        const supported = await this.client.doesServerSupportUnstableFeature(UNSTABLE_MSC4140_DELAYED_EVENTS);
        if (!supported) {
            throw new UnsupportedDelayedEventsEndpointError(
                "Server does not support the delayed events API",
                apiName,
            );
        }
    }

    /**
     * 取消已调度的延迟事件。
     *
     * @param delayId     服务端在调度延迟事件时返回的 delay_id
     * @param requestOpts 可选请求选项（localTimeoutMs / abortSignal / headers）
     */
    public async cancelScheduledDelayedEvent(delayId: string | number, requestOpts?: IRequestOpts): Promise<EmptyObject> {
        return await this.updateScheduledDelayedEvent(delayId, UpdateDelayedEventAction.Cancel, requestOpts);
    }

    /**
     * 重启（心跳）已调度的延迟事件。
     *
     * @param delayId     服务端在调度延迟事件时返回的 delay_id
     * @param requestOpts 可选请求选项（localTimeoutMs / abortSignal / headers）
     */
    public async restartScheduledDelayedEvent(delayId: string | number, requestOpts?: IRequestOpts): Promise<EmptyObject> {
        return await this.updateScheduledDelayedEvent(delayId, UpdateDelayedEventAction.Restart, requestOpts);
    }

    /**
     * 立即发送已调度的延迟事件（不再等待计划投递）。
     *
     * @param delayId     服务端在调度延迟事件时返回的 delay_id
     * @param requestOpts 可选请求选项（localTimeoutMs / abortSignal / headers）
     */
    public async sendScheduledDelayedEvent(delayId: string | number, requestOpts?: IRequestOpts): Promise<EmptyObject> {
        return await this.updateScheduledDelayedEvent(delayId, UpdateDelayedEventAction.Send, requestOpts);
    }

    /**
     * 统一的管理操作实现：action-in-BODY 单次请求。
     *
     * SDK-BL-005: 后端仅支持 `POST /delayed_events/{delay_id}` body `{ action }`，
     * 不支持 action-in-PATH，因此无需 fallback。
     *
     * FT-084/FT-101: 后端 delay_id 为 i64 (JSON number)，参数类型须接受 number。
     * number 类型校验为正整数（数据库 id 从 1 开始），string 类型走 requireNonEmptyString。
     */
    private async updateScheduledDelayedEvent(
        delayId: string | number,
        action: UpdateDelayedEventAction,
        requestOpts?: IRequestOpts,
    ): Promise<EmptyObject> {
        if (typeof delayId === "number") {
            if (!Number.isInteger(delayId) || delayId <= 0) {
                throw new ValidationError("delayId must be a positive integer or non-empty string");
            }
        } else {
            this.requireNonEmptyString(delayId, "delayId");
        }
        const delayIdStr = String(delayId);
        const apiName = `${action}ScheduledDelayedEvent` as DelayedEventClientEndpoint;
        await this.assertSupported(apiName);

        return await this.request<EmptyObject>({
            method: Method.Post,
            path: buildDelayedEventsPath(delayIdStr),
            prefix: DELAYED_EVENTS_PREFIX,
            body: { action },
            localTimeoutMs: requestOpts?.localTimeoutMs,
            headers: requestOpts?.headers,
            abortSignal: requestOpts?.abortSignal,
            // 管理操作不可重试（非幂等：cancel/restart/send 改变服务端状态）
            retry: { idempotent: false, retryNonIdempotent: false, maxRetries: 0 },
            label: `${action}ScheduledDelayedEvent`,
        });
    }
}

/**
 * 将 `getDelayedEventsManager()` 挂载到 `MatrixClient.prototype`。
 * 由 `manager-extensions` 在初始化时调用。
 */
export function extendMatrixClient(): void {
    MatrixClient.prototype.getDelayedEventsManager = function (): DelayedEventsManager {
        registerManagerClass("delayedEvents", DelayedEventsManager);
        return getOrCreateManager(this, "delayedEvents", () => new DelayedEventsManager(this));
    };
}
