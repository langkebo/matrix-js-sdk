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
 * Account Status Manager —— MSC3720（账户状态批量查询）。
 *
 * 只封装**有后端契约**的端点：`POST /_matrix/client/unstable/org.matrix.msc3720/account_status`
 * （`synapse-web/src/routes/handlers/account_status.rs`）。请求体 `{ user_ids: [...] }`，
 * 响应 `{ account_statuses, failures }`；空 `user_ids` 后端返回 `{}`。
 *
 * 该能力由后端 `experimental.msc3720_enabled`（默认 **false**）与
 * `org.matrix.msc3720.account_status` capability 双重把关：关闭时端点以 **403
 * `M_FORBIDDEN`** 失败（MSC 要求"不要泄漏过多用户信息"）。因此这里**fail closed**：
 * 探针说没有就抛 `UnsupportedAccountStatusEndpointError`，绝不盲目发请求。
 *
 * ⚠️ 历史：本模块此前**不存在** —— `SecurityManager` 曾自己造过
 * `GET /v3/account_status/{userId}` 与 `GET /login/failures` 两个后端从来没有的端点，
 * 2026-10 按"只保留有后端契约的能力"删除。现在补的是 MSC3720 的**真实**批量形状。
 */

import type { IRequestOpts } from "../http-api/interface";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { MatrixClient } from "../client";
import { getOrCreateManager, registerManagerClass } from "../client-infra/manager-registry";
import { UnsupportedAccountStatusEndpointError, ValidationError } from "../errors";
import { logger } from "../logger";
import { doesClientAdvertiseSynapseRustFeature, SynapseRustFeature } from "../server-capabilities";

/**
 * MSC3720 客户端端点的**相对**路径。
 *
 * 挂在 `ClientPrefix.Unstable`（`/_matrix/client/unstable`）下 —— MSC 编号端点不属于
 * 稳定 `/v3`，也不是本项目私有的 `/_matrix/vendor/v1`（ISSUE-13 只管后者）。
 */
const ACCOUNT_STATUS_PATH = "/org.matrix.msc3720/account_status";

/** 单个用户的账号状态。字段由 MSC3720 定义，允许服务端扩展（ADR-0005 开放形态）。 */
export interface AccountStatusEntry {
    /** 账号是否被锁定。 */
    locked?: boolean;
    /** 账号是否被暂停。 */
    suspended?: boolean;
    /** 服务端可扩展字段。 */
    [key: string]: unknown;
}

/** 一次批量查询里**失败**的条目（远端查询不上时后端把原因放这里）。 */
export interface AccountStatusFailure {
    errcode?: string;
    error?: string;
    [key: string]: unknown;
}

/** `POST /account_status` 的响应。空请求体时后端返回 `{}`，故两个字段都可选。 */
export interface AccountStatusBatchResponse {
    /** `user_id` → 状态。 */
    account_statuses?: Record<string, AccountStatusEntry>;
    /** `user_id` → 失败原因（远端失败时）。 */
    failures?: Record<string, AccountStatusFailure>;
}

/**
 * 账号状态管理器：`client.getAccountStatusManager()`。
 */
export class AccountStatusManager extends BaseManager {
    public constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 服务端是否声明 MSC3720 能力。
     *
     * **fail closed**：探针缺失或抛错都返回 `false`（对应后端默认关闭 + 403 的行为），
     * 而不是乐观地放行（S-13）。
     */
    public async isSupported(): Promise<boolean> {
        return doesClientAdvertiseSynapseRustFeature(this.client, SynapseRustFeature.AccountStatus, false, (error) =>
            logger.debug("AccountStatusManager.isSupported probe failed", error),
        );
    }

    /**
     * 批量查询账号状态（MSC3720）。
     *
     * @param userIds 要查询的用户 ID 列表；**允许为空数组**（MSC 规定返回空对象，
     *                后端不会因为空列表报错），顺序与响应无关（响应是映射）。
     * @param requestOpts 可选请求选项（localTimeoutMs / abortSignal / headers）
     * @returns `{ account_statuses, failures }`；两者都可能缺席（空请求 → `{}`）
     * @throws ValidationError 参数不是数组，或含空/非字符串项时
     * @throws UnsupportedAccountStatusEndpointError 服务端未声明该能力时（不发请求）
     * @example
     * ```typescript
     * const manager = client.getAccountStatusManager();
     * if (await manager.isSupported()) {
     *     const { account_statuses } = await manager.getAccountStatuses(["@alice:example.org"]);
     *     console.log(account_statuses?.["@alice:example.org"]?.locked);
     * }
     * ```
     */
    public async getAccountStatuses(
        userIds: string[],
        requestOpts?: IRequestOpts,
    ): Promise<AccountStatusBatchResponse> {
        if (!Array.isArray(userIds)) {
            throw new ValidationError("userIds must be an array of user IDs");
        }
        for (const userId of userIds) {
            if (typeof userId !== "string" || userId.length === 0) {
                throw new ValidationError("userIds must contain only non-empty user ID strings");
            }
        }

        if (!(await this.isSupported())) {
            throw new UnsupportedAccountStatusEndpointError(
                "Server does not advertise the org.matrix.msc3720.account_status capability",
            );
        }

        return await this.request<AccountStatusBatchResponse>({
            method: Method.Post,
            path: ACCOUNT_STATUS_PATH,
            prefix: ClientPrefix.Unstable,
            body: { user_ids: userIds },
            localTimeoutMs: requestOpts?.localTimeoutMs,
            headers: requestOpts?.headers,
            abortSignal: requestOpts?.abortSignal,
            label: "getAccountStatuses",
        });
    }
}

/**
 * 把 `getAccountStatusManager()` 挂到 `MatrixClient.prototype`；由 `manager-extensions` 调用。
 */
export function extendMatrixClient(): void {
    MatrixClient.prototype.getAccountStatusManager = function (): AccountStatusManager {
        registerManagerClass("accountStatus", AccountStatusManager);
        return getOrCreateManager(this, "accountStatus", () => new AccountStatusManager(this));
    };
}
