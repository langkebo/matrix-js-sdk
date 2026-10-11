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
 * Cross Signing Manager - 交叉签名管理
 *
 * 提供 cross-signing 功能
 */

import { MatrixClient } from "../client";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { CrossSigningKey } from "../crypto-api";

export interface CrossSigningStatus {
    crossSigningVerified: boolean;
    crossSigningVerifiedBefore: boolean;
    crossSigningTrusted: boolean;
}

export interface CrossSigningKeys {
    masterKey: string | null;
    selfSigningKey: string | null;
    userSigningKey: string | null;
}

export interface UserCrossSigningKeys {
    masterKey: string | null;
    selfSigningKey: string | null;
    userSigningKey: string | null;
    verified: boolean;
}

export interface CrossSigningManagerEvents {
    cross_signing_ready: () => void;
    cross_signing_updated: (data: { userId: string }) => void;
    cross_signing_trusted: (data: { userId: string }) => void;
}

export class CrossSigningManager extends BaseManager<keyof CrossSigningManagerEvents, CrossSigningManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 查询本用户的交叉签名状态（是否已验证 / 曾验证 / 受信任）。
     *
     * 未初始化加密时返回全 false 的默认状态。
     *
     * @returns 交叉签名状态
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getCrossSigningManager();
     * const status = await mgr.checkCrossSigningStatus();
     * console.log(status.crossSigningVerified);
     * ```
     */
    public async checkCrossSigningStatus(): Promise<CrossSigningStatus> {
        return this.withRetry(async () => {
            const crypto = this.client.getCrypto();
            if (!crypto) {
                return {
                    crossSigningVerified: false,
                    crossSigningVerifiedBefore: false,
                    crossSigningTrusted: false,
                };
            }
            const status = await crypto.getCrossSigningStatus();
            const userId = this.client.getUserId();
            let crossSigningVerified = false;
            let crossSigningVerifiedBefore = false;
            if (userId) {
                const verificationStatus = await crypto.getUserVerificationStatus(userId);
                crossSigningVerified = verificationStatus.isCrossSigningVerified();
                crossSigningVerifiedBefore = verificationStatus.wasCrossSigningVerified();
            }
            return {
                crossSigningVerified,
                crossSigningVerifiedBefore,
                crossSigningTrusted: status.publicKeysOnDevice,
            };
        }, "checkCrossSigningStatus");
    }

    /**
     * 获取本用户的三类交叉签名公钥 ID（主密钥 / 自签名 / 用户签名）。
     *
     * @returns 交叉签名密钥 ID 集合，未初始化加密时各项为 null
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getCrossSigningManager();
     * const keys = await mgr.getCrossSigningKeys();
     * console.log(keys.masterKey);
     * ```
     */
    public async getCrossSigningKeys(): Promise<CrossSigningKeys> {
        return this.withRetry(async () => {
            const crypto = this.client.getCrypto();
            if (!crypto) {
                return { masterKey: null, selfSigningKey: null, userSigningKey: null };
            }
            const [masterKey, selfSigningKey, userSigningKey] = await Promise.all([
                crypto.getCrossSigningKeyId(CrossSigningKey.Master),
                crypto.getCrossSigningKeyId(CrossSigningKey.SelfSigning),
                crypto.getCrossSigningKeyId(CrossSigningKey.UserSigning),
            ]);
            return { masterKey, selfSigningKey, userSigningKey };
        }, "getCrossSigningKeys");
    }

    /**
     * 判断交叉签名是否已就绪（可用于签名/验证）。
     *
     * @returns 已就绪返回 true，未初始化加密时返回 false
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getCrossSigningManager();
     * const ready = await mgr.isCrossSigningReady();
     * ```
     */
    public async isCrossSigningReady(): Promise<boolean> {
        const crypto = this.client.getCrypto();
        if (!crypto) return false;
        return crypto.isCrossSigningReady();
    }

    /**
     * 获取指定用户的交叉签名公钥及验证状态。
     *
     * @param userId - 目标用户的 Matrix 用户 ID
     * @returns 该用户的交叉签名密钥 ID 集合与是否已验证；无密钥或未初始化加密时各密钥为 null
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getCrossSigningManager();
     * const keys = await mgr.getUserCrossSigningKeys("@alice:example.org");
     * console.log(keys.verified);
     * ```
     */
    public async getUserCrossSigningKeys(userId: string): Promise<UserCrossSigningKeys> {
        return this.withRetry(async () => {
            const crypto = this.client.getCrypto();
            if (!crypto) {
                return { masterKey: null, selfSigningKey: null, userSigningKey: null, verified: false };
            }
            const [hasKeys, verificationStatus] = await Promise.all([
                crypto.userHasCrossSigningKeys(userId),
                crypto.getUserVerificationStatus(userId),
            ]);
            return {
                masterKey: hasKeys ? await crypto.getCrossSigningKeyId(CrossSigningKey.Master) : null,
                selfSigningKey: hasKeys ? await crypto.getCrossSigningKeyId(CrossSigningKey.SelfSigning) : null,
                userSigningKey: hasKeys ? await crypto.getCrossSigningKeyId(CrossSigningKey.UserSigning) : null,
                verified: verificationStatus.isCrossSigningVerified(),
            };
        }, "getUserCrossSigningKeys");
    }

    /**
     * 引导交叉签名并建立信任（调用底层 bootstrapCrossSigning）。
     *
     * 未初始化加密时直接返回，不执行任何操作。
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getCrossSigningManager();
     * await mgr.checkAndTrustCrossSigning();
     * ```
     */
    public async checkAndTrustCrossSigning(): Promise<void> {
        return this.withRetry(async () => {
            const crypto = this.client.getCrypto();
            if (!crypto) return;
            await crypto.bootstrapCrossSigning({});
        }, "checkAndTrustCrossSigning");
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getCrossSigningManager = function (): CrossSigningManager {
        registerManagerClass("crossSigning", CrossSigningManager);
        return getOrCreateManager(this, "crossSigning", () => new CrossSigningManager(this));
    };
}
