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
 * 只保留**有后端契约**的能力：会话安全评估（设备清单来自规范 `/devices`，设备信任来自
 * `CryptoApi.getDeviceVerificationStatus()` 的交叉签名推导）。
 *
 * ⚠️ 2026-10-01：删掉两个**不存在**的端点调用（`GET /account_status/{userId}`、
 * `GET /login/failures`）及其派生方法（`isAccountLocked` / `isAccountSuspended`）。
 * 判据：后端 ledger（`synapse-rust/tests/unit/fixtures/ledger_export_sdk/all.json`，1149 条路由）
 * 里 `account_status` / `security/summary` / `login/failures` **零命中**；上游 Synapse v1.162.0
 * 只有 `POST /_matrix/client/unstable/org.matrix.msc3720/account_status`（批量、unstable，
 * MSC3720 "Account status"），形状与 SDK 原先的 `GET /v3/account_status/{user_id}` 完全不同。
 * 属于"SDK 自造端点 + 假兜底"，按铁律 1/2 删除，而不是给它加一个永久 waiver。
 */

import { MatrixClient } from "../client";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export class SecurityManager extends BaseManager {
    public constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 检查当前客户端的会话安全性。
     *
     * 设备"是否已信任"**只能**来自规范的交叉签名推导
     * （`CryptoApi.getDeviceVerificationStatus(userId, deviceId).isVerified()`），
     * 不能自己算、更不能写死：本方法此前把 `hasVerifiedDevices` 实现成
     * `devices.some((_d) => true)`（只要设备非空就恒为真），于是 "No verified devices"
     * 这条 issue 永远不可能被记录 —— 一个不会失败的门禁（铁律 8 的反面）。
     */
    public async checkSessionSecurity(): Promise<{
        isSecure: boolean;
        issues: string[];
    }> {
        const issues: string[] = [];
        let isSecure = true;

        const devices = (await this.client.getDeviceManager().getDevices()) ?? [];
        if (devices.length === 0) {
            issues.push("No devices found");
            isSecure = false;
        }

        const crypto = this.client.getCrypto();
        const userId = this.client.getUserId();
        if (!crypto) {
            // 没有加密时**无法**评估设备信任 —— 如实报告，而不是假装安全。
            issues.push("Encryption is not enabled on this client; device trust cannot be evaluated");
            isSecure = false;
        } else if (userId) {
            let unverified = 0;
            for (const device of devices) {
                const status = await crypto.getDeviceVerificationStatus(userId, device.device_id);
                if (!status?.isVerified()) {
                    unverified += 1;
                }
            }
            if (unverified > 0) {
                issues.push(`${unverified} device(s) are not verified`);
                isSecure = false;
            }
        }

        return { isSecure, issues };
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSecurityManager = function (): SecurityManager {
        registerManagerClass("security", SecurityManager);
        return getOrCreateManager(this, "security", () => new SecurityManager(this));
    };
}
