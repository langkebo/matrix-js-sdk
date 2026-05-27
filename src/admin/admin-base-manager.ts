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
 * - 路径辅助函数：ap/apu
 */

import { Method } from "../http-api/method";
import { BaseManager } from "../managers/base-manager";
import { MatrixClient } from "../client";

export type AdminErrorCallback = (error: Error) => void;

type StripAdminPath<P extends string> =
    P extends `/_synapse/admin${infer Rest}` ? Rest : never;

/**
 * 类型安全的 Admin 路径断言函数
 * 用于已知符合 AdminPathPattern 的路径字面量
 */
export function ap<P extends StripAdminPath<string>>(path: P): P {
    return path;
}

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
export abstract class AdminBaseManager<
    Events extends string = string,
    EventMap extends Record<Events, any> = Record<Events, any>,
> extends BaseManager<Events, EventMap> {
    private readonly onError?: AdminErrorCallback;

    constructor(client: MatrixClient, onError?: AdminErrorCallback) {
        super(client);
        this.onError = onError;
    }

    /**
     * Admin v1 请求（带错误回调和事件发射）
     *
     * 覆盖 BaseManager.adminRequest，添加错误回调通知。
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
            return await super.adminRequest<T>(method, path, queryParams, body, label);
        } catch (err) {
            const error = this.normalizeError(err, label ?? "unknown");
            this.onError?.(error);
            throw error;
        }
    }

    /**
     * Admin v2 请求（/_synapse/admin 前缀，无版本号）
     *
     * 用于 v2 API 端点，如 GET /_synapse/admin/v2/users
     */
    protected async v2Request<T>(
        method: Method,
        path: string,
        queryParams?: Record<string, string | string[]>,
        body?: Record<string, unknown>,
        label?: string,
    ): Promise<T> {
        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<T>(
                    method,
                    path,
                    queryParams,
                    body,
                    { prefix: "/_synapse/admin" },
                );
            }, label ?? "v2Request");
        } catch (err) {
            const error = this.normalizeError(err, label ?? "unknown");
            this.onError?.(error);
            throw error;
        }
    }
}
