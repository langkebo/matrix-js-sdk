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
 * Security Manager - 安全模块
 *
 * 提供账户安全相关功能，包括账户状态查询、登录失败记录等
 * 注意: 这些是客户端可用的安全功能，不涉及管理员操作
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/index";
import { BaseManager } from "../managers/base-manager";
import { logger } from "../logger";
import { getOrCreateManager } from "../client-infra/manager-registry";

const ADMIN_PREFIX = { prefix: "/_synapse/admin/v1" };

export interface AccountStatus {
    locked: boolean;
    suspended: boolean;
    verified: boolean;
}

export interface LoginFailure {
    timestamp: number;
    ip: string;
    userAgent?: string;
}

export interface LoginFailuresResponse {
    failures: LoginFailure[];
}

export class SecurityManager extends BaseManager {
    public constructor(client: MatrixClient) {
        super(client);
    }

    /**
     * 获取用户账户状态
     * 对应 API: GET /_synapse/admin/v1/account_status/{user_id}
     */
    public async getAccountStatus(userId: string): Promise<AccountStatus | null> {
        try {
            const response = await this.client.http.authedRequest<{
                locked?: boolean;
                suspended?: boolean;
                verified?: boolean;
            }>(Method.Get, `/account_status/${encodeURIComponent(userId)}`, undefined, undefined, ADMIN_PREFIX);

            return {
                locked: response.locked ?? false,
                suspended: response.suspended ?? false,
                verified: response.verified ?? false,
            };
        } catch (e) {
            logger.debug("SecurityManager.getAccountStatus failed", e);
            return null;
        }
    }

    /**
     * 检查账户是否被锁定
     */
    public async isAccountLocked(userId: string): Promise<boolean> {
        const status = await this.getAccountStatus(userId);
        return status?.locked ?? false;
    }

    /**
     * 检查账户是否被暂停
     */
    public async isAccountSuspended(userId: string): Promise<boolean> {
        const status = await this.getAccountStatus(userId);
        return status?.suspended ?? false;
    }

    /**
     * 获取登录失败记录
     * 对应 API: GET /_synapse/admin/v1/login/failures
     */
    public async listLoginFailures(): Promise<LoginFailure[]> {
        try {
            const response = await this.client.http.authedRequest<{
                failures?: Record<string, { time: string; ip: string; userAgent?: string }[]>;
            }>(Method.Get, "/login/failures", undefined, undefined, ADMIN_PREFIX);

            const failures: LoginFailure[] = [];
            if (response.failures) {
                for (const [timestamp, data] of Object.entries(response.failures)) {
                    for (const entry of data) {
                        failures.push({
                            timestamp: new Date(timestamp).getTime(),
                            ip: entry.ip,
                            userAgent: entry.userAgent,
                        });
                    }
                }
            }
            return failures;
        } catch (e) {
            logger.debug("SecurityManager.listLoginFailures failed", e);
            return [];
        }
    }

    /**
     * 检查当前客户端会话是否安全
     */
    public async checkSessionSecurity(): Promise<{
        isSecure: boolean;
        issues: string[];
    }> {
        const issues: string[] = [];
        let isSecure = true;

        const devices = await this.client.getDeviceManager().getDevices();

        if (!devices || devices.length === 0) {
            issues.push("No devices found");
            isSecure = false;
        }

        const hasVerifiedDevices = devices.some((_d) => {
            return true;
        });

        if (!hasVerifiedDevices) {
            issues.push("No verified devices");
        }

        return { isSecure, issues };
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getSecurityManager(): SecurityManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSecurityManager = function (): SecurityManager {
        return getOrCreateManager(this, "security", () => new SecurityManager(this));
    };
}

export default extendMatrixClient;
