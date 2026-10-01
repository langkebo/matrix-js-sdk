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
 * Admin Policy Manager - 策略服务器管理
 *
 * 对应后端 `synapse-web/src/routes/admin/policy.rs`（MSC4284）：
 * - GET  /_synapse/admin/v1/policy/status - 获取策略服务器状态
 * - POST /_synapse/admin/v1/policy/check  - 触发策略检查
 *
 * 由 MSC4284 定义，用于集成外部策略服务器（content moderation server）。
 */

import { Method } from "../../http-api/method";
import { AdminBaseManager, type AdminErrorCallback, type ManagerOpts } from "../admin-base-manager";
import { MatrixClient } from "../../client";

/**
 * 策略服务器状态
 */
export interface PolicyServerStatus {
    /** 策略服务器是否启用 */
    enabled: boolean;
    /** 策略服务器端点 URL */
    endpoint: string | null;
    /** 失败模式："fail_open" 或 "fail_closed" */
    fail_mode: "fail_open" | "fail_closed";
}

/**
 * 策略检查请求
 */
export interface PolicyCheckRequest {
    /** 房间 ID，例如 !room:example.com */
    room_id: string;
    /** 执行动作的用户 ID，例如 @alice:example.com */
    user_id: string;
    /** 执行的动作："create", "join", "invite", "send" */
    action: "create" | "join" | "invite" | "send";
}

/**
 * 策略检查响应
 */
export interface PolicyCheckResponse {
    /** 是否允许操作 */
    allowed: boolean;
    /** 结果："allow" 或 "deny" */
    result: "allow" | "deny";
    /** 拒绝原因（仅在 allowed: false 时存在） */
    reason?: string;
}

/**
 * Admin Policy Manager
 *
 * 提供策略服务器（Content Moderation Server）管理功能。
 * 依据 MSC4284，用于查询策略服务器状态和触发实时策略检查。
 */
export class AdminPolicyManager extends AdminBaseManager {
    constructor(client: MatrixClient, onError?: AdminErrorCallback, opts?: ManagerOpts) {
        super(client, onError, opts);
    }

    /**
     * 获取策略服务器状态
     *
     * 返回策略服务器的启用状态、端点 URL 和失败模式。
     *
     * @returns 策略服务器状态
     *
     * @example
     * ```typescript
     * const status = await adminManager.policy.getStatus();
     * if (status.enabled) {
     *     console.log(`Policy server at ${status.endpoint}`);
     * }
     * ```
     */
    async getStatus(): Promise<PolicyServerStatus> {
        const res = await this.adminRequest<{
            enabled: boolean;
            endpoint: string | null;
            fail_mode: string;
        }>(
            Method.Get,
            "/policy/status",
            undefined,
            undefined,
            "policy.getStatus",
        );
        return {
            enabled: res.enabled,
            endpoint: res.endpoint,
            fail_mode: res.fail_mode as "fail_open" | "fail_closed",
        };
    }

    /**
     * 触发策略检查
     *
     * 同步调用策略服务器检查指定 (room_id, user_id, action) 的授权。
     * 注意：此方法会阻塞调用，直到策略服务器响应。
     *
     * @param request - 策略检查请求
     * @returns 策略检查结果
     *
     * @throws BadRequestError 如果请求参数无效
     *
     * @example
     * ```typescript
     * const result = await adminManager.policy.check({
     *     room_id: "!room:example.com",
     *     user_id: "@alice:example.com",
     *     action: "join"
     * });
     * if (!result.allowed) {
     *     console.log(`Denied: ${result.reason}`);
     * }
     * ```
     */
    async check(request: PolicyCheckRequest): Promise<PolicyCheckResponse> {
        // 验证 action 参数
        const validActions = ["create", "join", "invite", "send"] as const;
        if (!validActions.includes(request.action)) {
            throw new Error(`Invalid action: ${request.action}. Must be one of: ${validActions.join(", ")}`);
        }

        // 验证 room_id 和 user_id
        if (!request.room_id || request.room_id.trim() === "") {
            throw new Error("room_id must not be empty");
        }
        if (!request.user_id || request.user_id.trim() === "") {
            throw new Error("user_id must not be empty");
        }

        const res = await this.adminRequest<{ allowed: boolean; result: "allow" | "deny"; reason?: string }>(
            Method.Post,
            "/policy/check",
            undefined,
            { room_id: request.room_id, user_id: request.user_id, action: request.action },
            "policy.check",
        );
        const response: PolicyCheckResponse = {
            allowed: res.allowed,
            result: res.result,
        };
        if (!res.allowed && res.reason) {
            response.reason = res.reason;
        }
        return response;
    }
}