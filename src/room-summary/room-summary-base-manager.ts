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
 * Room Summary Base Manager - Room Summary 子 Manager 的公共基类
 *
 * 扩展 BaseManager，添加：
 * - requestV3：/_matrix/client/v3 前缀请求
 * - requestInternal：/_synapse/room_summary/v1 前缀请求
 * - roomPath / uncheckedRoomPath：路径辅助函数（分别断言 room 契约 / 显式逃生阀）
 * - validateRoomId/validateUserId/validateEventType：参数校验
 * - 错误回调：统一错误事件通知
 */

import { Method } from "../http-api/method";
import { ClientPrefix, VendorPrefix } from "../http-api/prefix";

import { validateRoomId, validateUserId, validateEventType } from "../common/validators";
import { type QueryDict, encodeUri } from "../http-api/utils";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { MatrixClient } from "../client";
import type { PathAssert, StripMsc4354, StripV3, StripVendor } from "../http-api/strip-prefix";
import type { RoomPath } from "../room/__generated__/route-table";
import type { RoomSummaryPath } from "./__generated__/route-table";

/** MSC4354（sticky events）的 unstable 前缀。 */
const MSC4354_PREFIX = "/_matrix/client/unstable/org.matrix.msc4354";

/**
 * 本基类可断言的契约路径集合。
 *
 * `room-summary` 目录历史上一部分端点其实归 `room` 模块（见
 * `docs/sdk-encapsulation-audit.md` §13.9），另一部分确归 `room-summary` 模块；
 * 按前缀归位后（vendor / MSC4354 unstable）两者都会出现，故断言取并集。
 */
type RoomScopedContractPath = RoomPath | RoomSummaryPath;

export type RoomSummaryErrorCallback = (error: Error) => void;

/**
 * Room Summary 子 Manager 的公共基类
 *
 * 提供 requestV3/requestInternal 请求方法和统一的参数校验。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export abstract class RoomSummaryBaseManager<
    Events extends string = string,
    EventMap extends Record<Events, any> = Record<Events, any>,
> extends BaseManager<Events, EventMap> {
    /* eslint-enable @typescript-eslint/no-explicit-any */
    protected readonly onError?: RoomSummaryErrorCallback;

    constructor(client: MatrixClient, onError?: RoomSummaryErrorCallback, opts?: ManagerOpts) {
        super(client, opts);
        this.onError = onError;
    }

    /**
     * 验证房间 ID 格式（委托到 common/validators）
     */
    protected validateRoomId(roomId: string): void {
        validateRoomId(roomId, { allowAlias: true });
    }

    /**
     * 验证用户 ID 格式（委托到 common/validators）
     */
    protected validateUserId(userId: string): void {
        validateUserId(userId);
    }

    /**
     * 验证事件类型格式（委托到 common/validators）
     */
    protected validateEventType(eventType: string): void {
        validateEventType(eventType);
    }

    /**
     * 内部：路径模板 + `$roomId` 替换（不做契约断言）。
     */
    private buildRoomScopedPath(pathTemplate: string, roomId: string): string {
        return encodeUri(pathTemplate, { $roomId: roomId });
    }

    /**
     * 构建「归 `room` 模块」的相对路径（带 `$roomId` 替换）。
     *
     * 本目录（room-summary）历史上承载了一批其实归属 `room` 模块的端点（见
     * `docs/sdk-encapsulation-audit.md` §13.9），此处把入参约束到 **`room` 契约**的路径模板，
     * 并交给 `PathAssert` 做 **segment 级精确比较**：段数不同、静态段拼错都会在调用点报错。
     *
     * ⚠️ 残留边界（契约表达能力所限，非断言缺陷）：契约侧的占位段（`{room_id}` 等）
     * 仍接受任意**单段**内容，因此 `/rooms/<任意单段>` 无法与真实 room id 区分。
     * 原理与实测见 `docs/sdk-encapsulation-audit.md` §13.12、§13.13。
     */
    protected roomPath<const P extends string>(
        pathTemplate: P & PathAssert<P, StripV3<RoomPath>>,
        roomId: string,
    ): string {
        return this.buildRoomScopedPath(pathTemplate, roomId);
    }

    /**
     * **逃生阀**：构造路径但**不做任何契约断言**。
     *
     * 只允许用于「契约归属 / 前缀与实现不一致」的**已知缺陷**处 —— 目前仅
     * `room-invite-policy-manager.ts` 的 `invite_blocklist` / `invite_allowlist`
     * （契约前缀是 `/_matrix/vendor/v1`，实现却用 `/_matrix/client/v3`）。
     * 详见 `docs/sdk-encapsulation-audit.md` §13.11。
     *
     * 注：这 4 处路径的契约归属其实是 `invite_blocklist`（前缀 `/_matrix/vendor/v1`），
     * 因此**无法**用 `room` 契约断言；走逃生阀是为了显式标注 + 便于检索
     * （`grep -rn uncheckedRoomPath src/`）。缺陷关闭后必须改回对应模块的强类型助手。
     */
    protected uncheckedRoomPath(pathTemplate: string, roomId: string): string {
        return this.buildRoomScopedPath(pathTemplate, roomId);
    }

    /**
     * 构建「前缀为 `/_matrix/vendor/v1`」的相对路径（带 `$roomId` 替换）。
     *
     * 与 `roomPath` 的区别只在**断言的前缀空间**：私有扩展已统一归位 vendor
     * （后端 Batch 1–3 与本轮 M2），若继续用 `roomPath`（断言 v3 空间），断言会被
     * 契约表里**只增不减的旧 v3 条目**满足 —— 那正是"路径正确"变成假绿的成因。
     */
    protected roomPathVendor<const P extends string>(
        pathTemplate: P & PathAssert<P, StripVendor<RoomScopedContractPath>>,
        roomId: string,
    ): string {
        return this.buildRoomScopedPath(pathTemplate, roomId);
    }

    /**
     * 构建「MSC4354（sticky events）unstable 前缀」下的相对路径（带 `$roomId` 替换）。
     */
    protected roomPathMsc4354<const P extends string>(
        pathTemplate: P & PathAssert<P, StripMsc4354<RoomScopedContractPath>>,
        roomId: string,
    ): string {
        return this.buildRoomScopedPath(pathTemplate, roomId);
    }

    /**
     * 发送 v3 前缀请求
     */
    protected requestV3<T>(method: Method, path: string, queryParams?: QueryDict, body?: unknown): Promise<T> {
        return this.request<T>({ method, path, queryParams, body, prefix: ClientPrefix.V3 });
    }

    /**
     * 发送 vendor 前缀请求（`/_matrix/vendor/v1`，私有扩展的唯一规范位置）
     */
    protected requestVendor<T>(method: Method, path: string, queryParams?: QueryDict, body?: unknown): Promise<T> {
        return this.request<T>({ method, path, queryParams, body, prefix: VendorPrefix });
    }

    /**
     * 发送 MSC4354（sticky events）unstable 前缀请求
     */
    protected requestMsc4354<T>(method: Method, path: string, queryParams?: QueryDict, body?: unknown): Promise<T> {
        return this.request<T>({ method, path, queryParams, body, prefix: MSC4354_PREFIX });
    }

    /**
     * 发送内部 API 请求
     */
    protected requestInternal<T>(method: Method, path: string, queryParams?: QueryDict, body?: unknown): Promise<T> {
        return this.request<T>({ method, path, queryParams, body, prefix: "/_synapse/room_summary/v1" });
    }
}
