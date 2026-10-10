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
import type { IContent } from "../models/event";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { MatrixClient } from "../client";

export type { ManagerOpts };

export type AdminErrorCallback = (error: Error) => void;

/**
 * 无类型断言的 Admin 路径函数
 * 用于动态拼接的路径
 */
export function apu(path: string): string {
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
