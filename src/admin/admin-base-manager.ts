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
 * Admin Base Manager - Admin 子 Manager 的公共基类
 *
 * 扩展 BaseManager，添加：
 * - v2Request：/_synapse/admin 前缀请求（无版本号）
 * - 错误回调：统一错误事件通知
 * - 路径辅助函数：apu
 */

import { Method } from "../http-api/method";
import { AdminPrefix } from "../http-api/prefix";
import type { PathAssert, StripPrefix } from "../http-api/strip-prefix";
import type { AdminPath } from "./__generated__/route-table";
import type { EventReportPath } from "../event-report/__generated__/route-table";
import type { ExternalServicePath } from "../external-service/__generated__/route-table";
import type { FeatureFlagsPath } from "../feature-flags/__generated__/route-table";
import type { ModulePath } from "../module/__generated__/route-table";
import type { RoomPath } from "../room/__generated__/route-table";
import type { TelemetryPath } from "../telemetry/__generated__/route-table";
import type { IContent } from "../models/event";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { MatrixClient } from "../client";

export type { ManagerOpts };

export type AdminErrorCallback = (error: Error) => void;

/**
 * 无类型断言的 Admin 路径函数
 * 用于动态拼接的路径
 */
/**
 * Admin 目录承载的契约路径**并集**。
 *
 * ⚠️ 为什么是并集：`admin` 这个 SDK 目录的 manager **跨 7 个 ledger 模块** —— 后端按功能域把
 * admin 面拆到了不同 `registered_by`（实测 2026-10-15：admin + feature_flags(7) + module(13) +
 * external_service(4) + telemetry(1) + room(1) + event_report(2)）。故断言必须对 7 张表取并集。
 * 同 `room-summary` 借 `RoomPath`、`app-service` 借 `ThirdpartyPath` 之例。
 */
type AdminScopedPath =
    | AdminPath
    | EventReportPath
    | ExternalServicePath
    | FeatureFlagsPath
    | ModulePath
    | RoomPath
    | TelemetryPath;

/**
 * Admin 模块的**多前缀**剥离类型。
 *
 * 7 张表的路径横跨 6 种前缀（实测：`_synapse/admin/v1` / `v2` / `_synapse/admin`(info)、
 * `_matrix/client/v3`、`_matrix/vendor/v1`），而实现侧的相对路径由各自的 `prefix:` 字段提供，
 * 故断言前要把这些前缀都剥掉。**顺序关键**：更具体的前缀必须先匹配
 * （`/v1`、`/v2` 先于 `/_synapse/admin`，否则 `/_synapse/admin/v1/users` 会剥成 `v1/users`）。
 */
export type StripAdminModule<P extends string> = StripPrefix<
    P,
    "/_synapse/admin/v1",
    StripPrefix<
        P,
        "/_synapse/admin/v2",
        StripPrefix<P, "/_synapse/admin", StripPrefix<P, "/_matrix/client/v3", StripPrefix<P, "/_matrix/vendor/v1">>>
    >
>;

/**
 * **带契约断言的** Admin 路径函数。
 *
 * 原先它是「无类型断言、用于动态拼接路径」的直通函数；2026-10-15 把 admin 收编进 codegen 后
 * 改为编译期断言（segment 级精确比较，见 `http-api/strip-prefix.ts`）—— admin 的每条手写相对
 * 路径都必须命中上述 7 张表的并集，后端改路由而实现没跟上时 `tsc` 先炸。
 *
 * 泛型参数必须写作 `const P` 才能拿到模板字面量类型（如 `` `/users/${string}` ``）。
 */
export function apu<const P extends string>(path: P & PathAssert<P, StripAdminModule<AdminScopedPath>>): P {
    return path;
}

/**
 * Admin 子 Manager 的公共基类
 *
 * 提供 adminRequest（继承自 BaseManager）和 v2Request，
 * 以及统一的错误回调机制。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export abstract class AdminBaseManager<
    Events extends string = string,
    EventMap extends Record<Events, any> = Record<Events, any>,
> extends BaseManager<Events, EventMap> {
    /* eslint-enable @typescript-eslint/no-explicit-any */
    private readonly onError?: AdminErrorCallback;
    private readonly adminMfaCodeProvider?: () => string;

    constructor(client: MatrixClient, onError?: AdminErrorCallback, opts?: ManagerOpts) {
        super(client, opts);
        this.onError = onError;
        this.adminMfaCodeProvider = opts?.adminMfaCodeProvider;
    }

    /**
     * 构造 admin 敏感操作所需的请求头。
     *
     * 当配置了 `adminMfaCodeProvider` 时注入 `x-admin-mfa-code`（每次调用重新取码，
     * 避免重试时复用已过期的 TOTP）；否则返回 `undefined`，不改变原有请求。
     */
    private adminMfaHeaders(): Record<string, string> | undefined {
        const code = this.adminMfaCodeProvider?.();
        return code ? { "x-admin-mfa-code": code } : undefined;
    }

    /**
     * Admin v1 请求（带错误回调和事件发射）
     *
     * 覆盖 BaseManager.adminRequest，添加错误回调通知与（可选的）admin MFA 头。
     * 所有子 Manager 的 admin 请求都应通过此方法发送。
     */
    protected async adminRequest<T>(
        method: Method,
        path: string,
        queryParams?: Record<string, string | string[]>,
        body?: object,
        label?: string,
    ): Promise<T> {
        try {
            return await this.request<T>({
                method,
                path,
                prefix: AdminPrefix.V1,
                queryParams,
                body: body ?? undefined,
                label,
                headers: this.adminMfaHeaders(),
            });
        } catch (err) {
            const error = this.normalizeError(err, label ?? "unknown");
            this.onError?.(error);
            throw error;
        }
    }

    /**
     * Admin 无版本段请求（前缀 `/_synapse/admin`，注意**不带** `/v1`）
     *
     * 用于两类端点：
     * 1. v2 API，如 `GET /_synapse/admin/v2/users`（path 里自带 `/v2`）；
     * 2. 后端注册在 `/_synapse/admin` 根下、**无版本段**的端点，
     *    典型是 `GET /_synapse/admin/info`（见 `admin-server-manager.getServerInfo` /
     *    `getAdminInfo`）。这类路径若用 `adminRequest`（前缀 `/_synapse/admin/v1`）
     *    会拼成 `/_synapse/admin/v1/info` → 必 404。
     */
    protected async v2Request<T>(
        method: Method,
        path: string,
        queryParams?: Record<string, string | string[]>,
        body?: IContent,
        label?: string,
    ): Promise<T> {
        try {
            return await this.request<T>({
                method,
                path,
                queryParams,
                body,
                prefix: "/_synapse/admin",
                label: label ?? "v2Request",
                headers: this.adminMfaHeaders(),
            });
        } catch (err) {
            const error = this.normalizeError(err, label ?? "unknown");
            this.onError?.(error);
            throw error;
        }
    }
}
