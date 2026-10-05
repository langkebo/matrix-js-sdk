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
import { ClientPrefix } from "../http-api/prefix";

import { validateRoomId, validateUserId, validateEventType } from "../common/validators";
import { type QueryDict, encodeUri } from "../http-api/utils";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { MatrixClient } from "../client";
import type { StripV3 } from "../http-api/strip-prefix";
import type { RoomPathPattern } from "../room/__generated__/route-table";

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
     * `docs/sdk-encapsulation-audit.md` §13.9），此处把入参约束到 **`room` 契约**的路径模板。
     *
     * ⚠️ **该断言的鉴别力有限，勿据此认为路径已受保护**：`RoomPathPattern` 由契约里的
     * `{name}` 替换为 `${string}` 生成，而 TS 的 `${string}` **可跨 `/`**，因此契约中
     * `GET /rooms/{room_id}` 这样的浅层「参数结尾」路由会产生 `/rooms/${string}` 前缀模式，
     * **吞掉整个 `/rooms/**` 子树** —— 任何 `/rooms/…` 字面量都会通过。
     * 实测见 `docs/sdk-encapsulation-audit.md` §13.12。根因修复（两侧归一 + 精确相等）
     * 落地前，本断言只能拦住「不以 `/rooms/` 开头且不匹配任何路由」的路径。
     */
    protected roomPath<P extends StripV3<RoomPathPattern>>(pathTemplate: P, roomId: string): string {
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
     * 注：这 4 处**并非**因为会被类型系统拒绝才走逃生阀（`roomPath` 对 `/rooms/**` 本就不设防，
     * 见 §13.12）；这里是**显式标注 + 便于检索**的意图。缺陷关闭后必须改回带真实鉴别力的断言。
     */
    protected uncheckedRoomPath(pathTemplate: string, roomId: string): string {
        return this.buildRoomScopedPath(pathTemplate, roomId);
    }

    /**
     * 发送 v3 前缀请求
     */
    protected requestV3<T>(method: Method, path: string, queryParams?: QueryDict, body?: unknown): Promise<T> {
        return this.request<T>({ method, path, queryParams, body, prefix: ClientPrefix.V3 });
    }

    /**
     * 发送内部 API 请求
     */
    protected requestInternal<T>(method: Method, path: string, queryParams?: QueryDict, body?: unknown): Promise<T> {
        return this.request<T>({ method, path, queryParams, body, prefix: "/_synapse/room_summary/v1" });
    }
}
